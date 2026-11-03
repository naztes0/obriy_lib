function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapLoan(row) {
  return {
    id: String(row.id),
    status: row.status,
    reader: {
      id: String(row.reader_id),
      fullName: row.full_name,
      ticketNumber: row.ticket_number,
    },
    book: { id: String(row.book_id), title: row.title },
    copy: { id: String(row.copy_id), inventoryNumber: row.inventory_number },
    issuedAt: row.issued_at,
    initialDueDate: toDateOnly(row.initial_due_date),
    currentDueDate: toDateOnly(row.current_due_date),
    returnedAt: row.returned_at,
    compensatedAt: row.compensated_at,
    issueCondition: row.issue_condition,
    issueDefectDescription: row.issue_defect_snapshot,
    returnCondition: row.return_condition,
    returnDefectDescription: row.return_defect_snapshot,
    readerCategoryAtIssue: row.reader_category_snapshot,
    classNameAtIssue: row.class_name_snapshot,
    extension: row.extension_old_due_date
      ? {
          oldDueDate: toDateOnly(row.extension_old_due_date),
          newDueDate: toDateOnly(row.extension_new_due_date),
          reason: row.extension_reason,
          occurredAt: row.extension_occurred_at,
        }
      : null,
    version: String(row.version),
  };
}

async function reserveRequest(client, { actorId, operation, requestKey }) {
  const inserted = await client.query(
    `INSERT INTO processed_requests (actor_id, operation, request_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (actor_id, operation, request_key) DO NOTHING
     RETURNING id`,
    [actorId, operation, requestKey],
  );
  if (inserted.rowCount) return { isNew: true };
  const existing = await client.query(
    `SELECT result_entity_id FROM processed_requests
     WHERE actor_id = $1 AND operation = $2 AND request_key = $3`,
    [actorId, operation, requestKey],
  );
  return { isNew: false, resultId: String(existing.rows[0].result_entity_id) };
}

async function completeRequest(client, { actorId, operation, requestKey, resultId }) {
  await client.query(
    `UPDATE processed_requests SET result_entity_id = $4
     WHERE actor_id = $1 AND operation = $2 AND request_key = $3`,
    [actorId, operation, requestKey, resultId],
  );
}

export class LoanRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(loanId) {
    const result = await this.pool.query(
      `SELECT l.*, rpd.full_name, rpd.ticket_number,
              b.id AS book_id, b.title, bc.inventory_number,
              le.old_due_date AS extension_old_due_date,
              le.new_due_date AS extension_new_due_date,
              le.reason AS extension_reason,
              le.occurred_at AS extension_occurred_at
       FROM loans l
       LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
       JOIN book_copies bc ON bc.id = l.copy_id
       JOIN books b ON b.id = bc.book_id
       LEFT JOIN loan_extensions le ON le.loan_id = l.id
       WHERE l.id = $1`,
      [loanId],
    );
    return result.rowCount ? mapLoan(result.rows[0]) : null;
  }

  async findCopyById(copyId) {
    const result = await this.pool.query(
      `SELECT id, is_lost, condition, defect_description, version
       FROM book_copies WHERE id = $1`,
      [copyId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: String(row.id),
      isLost: row.is_lost,
      condition: row.condition,
      defectDescription: row.defect_description,
      version: String(row.version),
    };
  }

  async issueLoan({ readerId, copyId, issueDate, defaultDueDate, requestedDueDate, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = 'issue_loan';
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', loanId: reservation.resultId };
      }

      const reader = await client.query(
        `SELECT rpd.reader_id, rpd.category, rpd.ticket_expires_on,
                rpd.archived_at, sc.name AS class_name
         FROM reader_personal_data rpd
         LEFT JOIN school_classes sc ON sc.id = rpd.class_id
         WHERE rpd.reader_id = $1
         FOR UPDATE OF rpd`,
        [readerId],
      );
      if (!reader.rowCount) return await this.rollbackStatus(client, 'reader_not_found');
      const readerRow = reader.rows[0];
      if (readerRow.archived_at !== null) return await this.rollbackStatus(client, 'reader_archived');
      const ticketExpiresOn = toDateOnly(readerRow.ticket_expires_on);
      if (readerRow.category === 'student' && ticketExpiresOn < issueDate) {
        return await this.rollbackStatus(client, 'ticket_expired');
      }

      const copy = await client.query(
        `SELECT bc.id, bc.condition, bc.defect_description, bc.is_temporarily_unavailable,
                bc.is_lost, bc.archived_at, b.id AS book_id, b.archived_at AS book_archived_at,
                b.is_textbook
         FROM book_copies bc JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1 FOR UPDATE OF bc`,
        [copyId],
      );
      if (!copy.rowCount) return await this.rollbackStatus(client, 'copy_not_found');
      const copyRow = copy.rows[0];
      if (copyRow.book_archived_at !== null) return await this.rollbackStatus(client, 'book_archived');
      if (copyRow.archived_at !== null) return await this.rollbackStatus(client, 'copy_archived');
      if (copyRow.is_lost) return await this.rollbackStatus(client, 'copy_lost');
      if (copyRow.is_temporarily_unavailable) {
        return await this.rollbackStatus(client, 'copy_temporarily_unavailable');
      }
      if (!['good', 'worn'].includes(copyRow.condition)) {
        return await this.rollbackStatus(client, 'copy_condition_unavailable');
      }
      const openLoan = await client.query(
        `SELECT id FROM loans WHERE copy_id = $1 AND status IN ('issued', 'lost') LIMIT 1`,
        [copyId],
      );
      if (openLoan.rowCount) return await this.rollbackStatus(client, 'copy_on_loan');
      if (requestedDueDate && !copyRow.is_textbook) {
        return await this.rollbackStatus(client, 'custom_due_date_not_allowed');
      }

      let dueDate = requestedDueDate ?? defaultDueDate;
      if (dueDate < issueDate) return await this.rollbackStatus(client, 'invalid_due_date');
      if (readerRow.category === 'student' && ticketExpiresOn < dueDate) dueDate = ticketExpiresOn;

      const result = await client.query(
        `INSERT INTO loans (
           reader_id, copy_id, issued_by, initial_due_date, current_due_date, status,
           issue_condition, issue_defect_snapshot, reader_category_snapshot, class_name_snapshot
         ) VALUES ($1, $2, $3, $4, $4, 'issued', $5, $6, $7, $8)
         RETURNING id`,
        [
          readerId,
          copyId,
          actorId,
          dueDate,
          copyRow.condition,
          copyRow.defect_description,
          readerRow.category,
          readerRow.class_name,
        ],
      );
      const loanId = String(result.rows[0].id);
      await client.query(
        `INSERT INTO loan_status_events (loan_id, from_status, to_status, actor_id, request_key)
         VALUES ($1, NULL, 'issued', $2, $3)`,
        [loanId, actorId, requestKey],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, actor_id, loan_id, request_key
         ) VALUES ($1, 'issued', $2, $2, $3, $4, $5)`,
        [
          copyId,
          JSON.stringify({
            condition: copyRow.condition,
            defectDescription: copyRow.defect_description,
          }),
          actorId,
          loanId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
      await client.query('COMMIT');
      return { status: 'created', loanId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async returnLoan(loanId, { version, condition, defectDescription, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `return_loan:${loanId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', loanId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT l.status, l.version, l.copy_id, bc.condition, bc.defect_description, bc.is_lost
         FROM loans l JOIN book_copies bc ON bc.id = l.copy_id
         WHERE l.id = $1 FOR UPDATE OF l, bc`,
        [loanId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'loan_not_found');
      const row = current.rows[0];
      if (row.status === 'returned') {
        await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
        await client.query('COMMIT');
        return { status: 'already_returned', loanId };
      }
      if (!['issued', 'lost'].includes(row.status)) {
        return await this.rollbackStatus(client, 'invalid_status');
      }
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');

      await client.query(
        `UPDATE loans
         SET status = 'returned', returned_at = now(), return_condition = $2,
             return_defect_snapshot = $3, version = version + 1
         WHERE id = $1`,
        [loanId, condition, defectDescription],
      );
      await client.query(
        `UPDATE book_copies
         SET condition = $2, defect_description = $3, is_lost = false, version = version + 1
         WHERE id = $1`,
        [row.copy_id, condition, defectDescription],
      );
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, request_key
         ) VALUES ($1, $2, 'returned', $3, $4)`,
        [loanId, row.status, actorId, requestKey],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, actor_id, loan_id, request_key
         ) VALUES ($1, 'returned', $2, $3, $4, $5, $6)`,
        [
          row.copy_id,
          JSON.stringify({
            condition: row.condition,
            defectDescription: row.defect_description,
            isLost: row.is_lost,
          }),
          JSON.stringify({ condition, defectDescription, isLost: false }),
          actorId,
          loanId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
      await client.query('COMMIT');
      return { status: 'returned', loanId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async extendLoan(loanId, { version, newDueDate, reason, today, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `extend_loan:${loanId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', loanId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT l.status, l.version, l.reader_id, l.current_due_date,
                rpd.category, rpd.ticket_expires_on, rpd.archived_at
         FROM loans l
         LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
         WHERE l.id = $1 FOR UPDATE OF l`,
        [loanId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'loan_not_found');
      const row = current.rows[0];
      if (row.status !== 'issued') return await this.rollbackStatus(client, 'invalid_status');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      if (row.category === null || row.archived_at !== null) {
        return await this.rollbackStatus(client, 'reader_unavailable');
      }
      const oldDueDate = toDateOnly(row.current_due_date);
      if (today > oldDueDate) return await this.rollbackStatus(client, 'extension_period_ended');
      const existingExtension = await client.query(
        'SELECT 1 FROM loan_extensions WHERE loan_id = $1',
        [loanId],
      );
      if (existingExtension.rowCount) return await this.rollbackStatus(client, 'already_extended');

      const maximumDueDate = new Date(`${oldDueDate}T00:00:00.000Z`);
      maximumDueDate.setUTCDate(maximumDueDate.getUTCDate() + 30);
      const maximum = maximumDueDate.toISOString().slice(0, 10);
      if (newDueDate <= oldDueDate || newDueDate > maximum) {
        return await this.rollbackStatus(client, 'invalid_extension_date');
      }
      const ticketExpiresOn = toDateOnly(row.ticket_expires_on);
      if (row.category === 'student' && newDueDate > ticketExpiresOn) {
        return await this.rollbackStatus(client, 'ticket_limit_exceeded');
      }
      const obligations = await client.query(
        `SELECT
           EXISTS (
             SELECT 1 FROM loans
             WHERE reader_id = $1 AND status = 'issued' AND current_due_date < $2::date
           ) AS has_overdue,
           EXISTS (
             SELECT 1 FROM loans WHERE reader_id = $1 AND status = 'lost'
           ) AS has_loss`,
        [row.reader_id, today],
      );
      if (obligations.rows[0].has_overdue) return await this.rollbackStatus(client, 'reader_overdue');
      if (obligations.rows[0].has_loss) return await this.rollbackStatus(client, 'reader_has_loss');

      await client.query(
        `INSERT INTO loan_extensions (
           loan_id, old_due_date, new_due_date, reason, actor_id, request_key
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [loanId, oldDueDate, newDueDate, reason, actorId, requestKey],
      );
      await client.query(
        `UPDATE loans SET current_due_date = $2, version = version + 1 WHERE id = $1`,
        [loanId, newDueDate],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
      await client.query('COMMIT');
      return { status: 'extended', loanId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markLoanLost(loanId, { version, comment, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `lose_loan:${loanId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', loanId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT l.status, l.version, l.copy_id, bc.is_lost
         FROM loans l JOIN book_copies bc ON bc.id = l.copy_id
         WHERE l.id = $1 FOR UPDATE OF l, bc`,
        [loanId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'loan_not_found');
      const row = current.rows[0];
      if (row.status === 'lost') {
        await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
        await client.query('COMMIT');
        return { status: 'already_lost', loanId };
      }
      if (row.status !== 'issued') return await this.rollbackStatus(client, 'invalid_status');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');

      await client.query(
        `UPDATE loans SET status = 'lost', version = version + 1 WHERE id = $1`,
        [loanId],
      );
      await client.query(
        `UPDATE book_copies SET is_lost = true, version = version + 1 WHERE id = $1`,
        [row.copy_id],
      );
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, comment, request_key
         ) VALUES ($1, 'issued', 'lost', $2, $3, $4)`,
        [loanId, actorId, comment, requestKey],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, loan_id, request_key
         ) VALUES ($1, 'lost', $2, $3, $4, $5, $6, $7)`,
        [
          row.copy_id,
          JSON.stringify({ isLost: row.is_lost }),
          JSON.stringify({ isLost: true }),
          comment,
          actorId,
          loanId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
      await client.query('COMMIT');
      return { status: 'lost', loanId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async compensateLoan(loanId, { version, comment, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `compensate_loan:${loanId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', loanId: reservation.resultId };
      }
      const current = await client.query(
        'SELECT status, version FROM loans WHERE id = $1 FOR UPDATE',
        [loanId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'loan_not_found');
      const row = current.rows[0];
      if (row.status === 'compensated') {
        await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
        await client.query('COMMIT');
        return { status: 'already_compensated', loanId };
      }
      if (row.status !== 'lost') return await this.rollbackStatus(client, 'invalid_status');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');

      await client.query(
        `UPDATE loans
         SET status = 'compensated', compensated_at = now(), version = version + 1
         WHERE id = $1`,
        [loanId],
      );
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, comment, request_key
         ) VALUES ($1, 'lost', 'compensated', $2, $3, $4)`,
        [loanId, actorId, comment, requestKey],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: loanId });
      await client.query('COMMIT');
      return { status: 'compensated', loanId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markCopyFound(copyId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `find_copy:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT id, is_lost, version FROM book_copies WHERE id = $1 FOR UPDATE`,
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'copy_not_found');
      const row = current.rows[0];
      if (!row.is_lost) return await this.rollbackStatus(client, 'copy_not_lost');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      const openLoan = await client.query(
        `SELECT 1 FROM loans WHERE copy_id = $1 AND status IN ('issued', 'lost') LIMIT 1`,
        [copyId],
      );
      if (openLoan.rowCount) return await this.rollbackStatus(client, 'copy_has_open_loan');

      await client.query(
        `UPDATE book_copies SET is_lost = false, version = version + 1 WHERE id = $1`,
        [copyId],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, request_key
         ) VALUES ($1, 'found', $2, $3, $4, $5, $6)`,
        [
          copyId,
          JSON.stringify({ isLost: true }),
          JSON.stringify({ isLost: false }),
          reason,
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'found', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackStatus(client, status) {
    await client.query('ROLLBACK');
    return { status };
  }
}
