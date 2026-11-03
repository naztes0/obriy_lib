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
    issueCondition: row.issue_condition,
    issueDefectDescription: row.issue_defect_snapshot,
    returnCondition: row.return_condition,
    returnDefectDescription: row.return_defect_snapshot,
    readerCategoryAtIssue: row.reader_category_snapshot,
    classNameAtIssue: row.class_name_snapshot,
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
              b.id AS book_id, b.title, bc.inventory_number
       FROM loans l
       LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
       JOIN book_copies bc ON bc.id = l.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE l.id = $1`,
      [loanId],
    );
    return result.rowCount ? mapLoan(result.rows[0]) : null;
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

  async returnLoan(loanId, { condition, defectDescription, actorId, requestKey }) {
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
        `SELECT l.status, l.copy_id, bc.condition, bc.defect_description
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
      if (row.status !== 'issued') return await this.rollbackStatus(client, 'invalid_status');

      await client.query(
        `UPDATE loans
         SET status = 'returned', returned_at = now(), return_condition = $2,
             return_defect_snapshot = $3, version = version + 1
         WHERE id = $1`,
        [loanId, condition, defectDescription],
      );
      await client.query(
        `UPDATE book_copies
         SET condition = $2, defect_description = $3, version = version + 1
         WHERE id = $1`,
        [row.copy_id, condition, defectDescription],
      );
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, request_key
         ) VALUES ($1, 'issued', 'returned', $2, $3)`,
        [loanId, actorId, requestKey],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, actor_id, loan_id, request_key
         ) VALUES ($1, 'returned', $2, $3, $4, $5, $6)`,
        [
          row.copy_id,
          JSON.stringify({ condition: row.condition, defectDescription: row.defect_description }),
          JSON.stringify({ condition, defectDescription }),
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

  async rollbackStatus(client, status) {
    await client.query('ROLLBACK');
    return { status };
  }
}
