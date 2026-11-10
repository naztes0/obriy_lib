function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value;
}

function mapReader(row) {
  return {
    id: String(row.reader_id),
    fullName: row.full_name,
    category: row.category,
    schoolClass: row.class_id === null ? null : { id: String(row.class_id), name: row.class_name },
    phone: row.phone,
    address: row.address,
    ticketNumber: row.ticket_number,
    ticketType: row.ticket_type,
    ticketIssuedOn: toDateOnly(row.ticket_issued_on),
    ticketExpiresOn: toDateOnly(row.ticket_expires_on),
    employmentEndedOn: toDateOnly(row.employment_ended_on),
    isArchived: row.archived_at !== null,
    isBlocked: row.is_blocked,
    archiveReason: row.archive_reason,
    version: String(row.version),
  };
}

const READER_SELECT = `SELECT rpd.reader_id, rpd.full_name, rpd.category, rpd.class_id,
                              sc.name AS class_name, rpd.phone, rpd.address,
                              rpd.ticket_number, rpd.ticket_type, rpd.ticket_issued_on,
                              rpd.ticket_expires_on, rpd.employment_ended_on,
                              rpd.archived_at, rpd.archive_reason,
                              rpd.version,
                              EXISTS (
                                SELECT 1 FROM reader_blocks rb
                                WHERE rb.reader_id = rpd.reader_id
                                  AND rb.resolved_at IS NULL
                                  AND rb.annulled_at IS NULL
                              ) AS is_blocked
                       FROM reader_personal_data rpd
                       LEFT JOIN school_classes sc ON sc.id = rpd.class_id`;

function snapshot(row) {
  return {
    fullName: row.full_name,
    category: row.category,
    classId: row.class_id === null ? null : String(row.class_id),
    phone: row.phone,
    address: row.address,
    ticketNumber: row.ticket_number,
    ticketType: row.ticket_type,
    ticketIssuedOn: toDateOnly(row.ticket_issued_on),
    ticketExpiresOn: toDateOnly(row.ticket_expires_on),
    employmentEndedOn: toDateOnly(row.employment_ended_on),
  };
}

function mapLoan(loan) {
  return {
    id: String(loan.id),
    status: loan.status,
    issuedAt: loan.issued_at,
    initialDueDate: toDateOnly(loan.initial_due_date),
    currentDueDate: toDateOnly(loan.current_due_date),
    returnedAt: loan.returned_at,
    compensatedAt: loan.compensated_at,
    book: { id: String(loan.book_id), title: loan.title },
    copy: { id: String(loan.copy_id), inventoryNumber: loan.inventory_number },
  };
}

const LOAN_SELECT = `SELECT l.id, l.status, l.issued_at, l.initial_due_date, l.current_due_date,
                            l.returned_at, l.compensated_at, b.id AS book_id, b.title,
                            bc.id AS copy_id, bc.inventory_number
                     FROM loans l
                     JOIN book_copies bc ON bc.id = l.copy_id
                     JOIN books b ON b.id = bc.book_id`;

async function validateActiveClass(client, classId) {
  if (classId === null) return true;
  const result = await client.query(
    'SELECT id FROM school_classes WHERE id = $1 AND is_active = true FOR SHARE',
    [classId],
  );
  return result.rowCount > 0;
}

async function generateTicketNumber(client) {
  for (;;) {
    const sequence = await client.query(
      "SELECT nextval('electronic_ticket_number_seq')::text AS value",
    );
    const candidate = `E-${sequence.rows[0].value}`;
    const exists = await client.query(
      'SELECT 1 FROM reader_personal_data WHERE upper(ticket_number) = upper($1)',
      [candidate],
    );
    if (!exists.rowCount) return candidate;
  }
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

export class ReaderRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listReaders({ query, archived, pageSize, offset }) {
    const values = [];
    const conditions = [];
    if (query) {
      values.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`);
      conditions.push(
        `(rpd.full_name ILIKE $${values.length} ESCAPE '\\' OR rpd.ticket_number ILIKE $${values.length} ESCAPE '\\')`,
      );
    }
    if (archived === 'active') conditions.push('rpd.archived_at IS NULL');
    if (archived === 'archived') conditions.push('rpd.archived_at IS NOT NULL');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const count = await this.pool.query(
      `SELECT count(*) AS total FROM reader_personal_data rpd ${where}`,
      values,
    );
    const result = await this.pool.query(
      `${READER_SELECT}
       ${where}
       ORDER BY lower(rpd.full_name), rpd.reader_id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    return {
      readers: result.rows.map(mapReader),
      totalItems: Number(count.rows[0].total),
    };
  }

  async findById(readerId) {
    const result = await this.pool.query(`${READER_SELECT} WHERE rpd.reader_id = $1`, [readerId]);
    if (!result.rowCount) return null;

    const currentLoans = await this.pool.query(
      `${LOAN_SELECT}
       WHERE l.reader_id = $1 AND l.status IN ('issued', 'lost')
       ORDER BY l.issued_at DESC, l.id DESC`,
      [readerId],
    );
    const history = await this.pool.query(
      `${LOAN_SELECT}
       WHERE l.reader_id = $1
       ORDER BY l.issued_at DESC, l.id DESC
       LIMIT 25`,
      [readerId],
    );
    const historyCount = await this.pool.query(
      'SELECT count(*) AS total FROM loans WHERE reader_id = $1',
      [readerId],
    );
    return {
      ...mapReader(result.rows[0]),
      currentLoans: currentLoans.rows.map(mapLoan),
      loanHistory: history.rows.map(mapLoan),
      loanHistoryTotal: Number(historyCount.rows[0].total),
    };
  }

  async findNamesakes(fullNameNormalized, excludeReaderId = null) {
    const result = await this.pool.query(
      `SELECT reader_id, full_name, ticket_number, archived_at
       FROM reader_personal_data
       WHERE lower(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g')) = $1
         AND ($2::bigint IS NULL OR reader_id <> $2)
       ORDER BY archived_at NULLS FIRST, reader_id`,
      [fullNameNormalized, excludeReaderId],
    );
    return result.rows.map((row) => ({
      id: String(row.reader_id),
      fullName: row.full_name,
      ticketNumber: row.ticket_number,
      isArchived: row.archived_at !== null,
    }));
  }

  async createReader(reader, actorId, ticketIssuedOn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await validateActiveClass(client, reader.classId))) {
        await client.query('ROLLBACK');
        return { status: 'class_unavailable' };
      }
      const ticketNumber =
        reader.ticketType === 'electronic'
          ? await generateTicketNumber(client)
          : reader.ticketNumber;
      const readerResult = await client.query('INSERT INTO readers DEFAULT VALUES RETURNING id');
      const readerId = String(readerResult.rows[0].id);
      await client.query(
        `INSERT INTO reader_personal_data (
           reader_id, full_name, category, class_id, phone, address,
           ticket_number, ticket_type, ticket_issued_on, ticket_expires_on
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          readerId,
          reader.fullName,
          reader.category,
          reader.classId,
          reader.phone,
          reader.address,
          ticketNumber,
          reader.ticketType,
          reader.ticketType === 'electronic' ? ticketIssuedOn : null,
          reader.ticketExpiresOn,
        ],
      );
      await client.query(
        `INSERT INTO reader_personal_data_changes (
           reader_id, event_type, old_value, new_value, actor_id
         ) VALUES ($1, 'created', NULL, $2, $3)`,
        [readerId, JSON.stringify({ ...reader, ticketNumber }), actorId],
      );
      await client.query('COMMIT');
      return { status: 'created', readerId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateReader(readerId, reader, { actorId, reason, expectedTicketNumber }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT * FROM reader_personal_data WHERE reader_id = $1 FOR UPDATE`,
        [readerId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (current.rows[0].ticket_number !== expectedTicketNumber) {
        await client.query('ROLLBACK');
        return { status: 'ticket_changed' };
      }
      const currentClassId =
        current.rows[0].class_id === null ? null : String(current.rows[0].class_id);
      if (currentClassId !== reader.classId && !(await validateActiveClass(client, reader.classId))) {
        await client.query('ROLLBACK');
        return { status: 'class_unavailable' };
      }

      const oldValue = snapshot(current.rows[0]);
      const newValue = {
        fullName: reader.fullName,
        category: reader.category,
        classId: reader.classId,
        phone: reader.phone,
        address: reader.address,
        ticketNumber: reader.ticketNumber,
        ticketType: current.rows[0].ticket_type,
        ticketIssuedOn: current.rows[0].ticket_issued_on,
        ticketExpiresOn: reader.ticketExpiresOn,
        employmentEndedOn:
          reader.category === 'employee'
            ? toDateOnly(current.rows[0].employment_ended_on)
            : null,
      };
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        await client.query('COMMIT');
        return { status: 'unchanged' };
      }

      await client.query(
        `UPDATE reader_personal_data
         SET full_name = $2, category = $3, class_id = $4, phone = $5,
             address = $6, ticket_number = $7, ticket_expires_on = $8,
             employment_ended_on = CASE
               WHEN $3 = 'employee' THEN employment_ended_on
               ELSE NULL
             END,
             version = version + 1
         WHERE reader_id = $1`,
        [
          readerId,
          reader.fullName,
          reader.category,
          reader.classId,
          reader.phone,
          reader.address,
          reader.ticketNumber,
          reader.ticketExpiresOn,
        ],
      );
      await client.query(
        `INSERT INTO reader_personal_data_changes (
           reader_id, event_type, old_value, new_value, reason, actor_id
         ) VALUES ($1, 'updated', $2, $3, $4, $5)`,
        [readerId, JSON.stringify(oldValue), JSON.stringify(newValue), reason || null, actorId],
      );
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveReader(readerId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = 'archive_reader';
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', readerId: reservation.resultId };
      }

      const reader = await client.query(
        `SELECT reader_id, archived_at, version
         FROM reader_personal_data
         WHERE reader_id = $1
         FOR UPDATE`,
        [readerId],
      );
      if (!reader.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = reader.rows[0];
      if (row.archived_at !== null) return await this.rollbackStatus(client, 'already_archived');
      if (String(row.version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }

      const openLoans = await client.query(
        `SELECT id FROM loans
         WHERE reader_id = $1 AND status IN ('issued', 'lost')
         LIMIT 1`,
        [readerId],
      );
      if (openLoans.rowCount) return await this.rollbackStatus(client, 'open_loans');

      await client.query(
        `UPDATE reader_personal_data
         SET archived_at = now(), archive_reason = $2, version = version + 1
         WHERE reader_id = $1`,
        [readerId, reason],
      );
      await client.query(
        `INSERT INTO reader_record_events (reader_id, event_type, actor_id, reason)
         VALUES ($1, 'archived', $2, $3)`,
        [readerId, actorId, reason],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: readerId });
      await client.query('COMMIT');
      return { status: 'archived', readerId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreReader(readerId, { version, today, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = 'restore_reader';
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', readerId: reservation.resultId };
      }

      const reader = await client.query(
        `SELECT reader_id, category, ticket_expires_on, archived_at, version
         FROM reader_personal_data
         WHERE reader_id = $1
         FOR UPDATE`,
        [readerId],
      );
      if (!reader.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = reader.rows[0];
      if (row.archived_at === null) return await this.rollbackStatus(client, 'not_archived');
      if (String(row.version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }
      if (row.category === 'student' && toDateOnly(row.ticket_expires_on) < today) {
        return await this.rollbackStatus(client, 'ticket_expired');
      }

      const openLoans = await client.query(
        `SELECT id FROM loans
         WHERE reader_id = $1 AND status IN ('issued', 'lost')
         LIMIT 1`,
        [readerId],
      );
      if (openLoans.rowCount) return await this.rollbackStatus(client, 'open_loans');

      await client.query(
        `UPDATE reader_personal_data
         SET archived_at = NULL, archive_reason = NULL, version = version + 1
         WHERE reader_id = $1`,
        [readerId],
      );
      await client.query(
        `INSERT INTO reader_record_events (reader_id, event_type, actor_id)
         VALUES ($1, 'restored', $2)`,
        [readerId, actorId],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: readerId });
      await client.query('COMMIT');
      return { status: 'restored', readerId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setEmploymentEnd(readerId, { version, employmentEndedOn, actorId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT reader_id, category, employment_ended_on, version
         FROM reader_personal_data
         WHERE reader_id = $1
         FOR UPDATE`,
        [readerId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (row.category !== 'employee') {
        return await this.rollbackStatus(client, 'not_employee');
      }
      if (String(row.version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }
      const oldValue = toDateOnly(row.employment_ended_on);
      if (oldValue === employmentEndedOn) {
        await client.query('COMMIT');
        return { status: 'unchanged', readerId };
      }

      await client.query(
        `UPDATE reader_personal_data
         SET employment_ended_on = $2, version = version + 1
         WHERE reader_id = $1`,
        [readerId, employmentEndedOn],
      );
      await client.query(
        `INSERT INTO reader_personal_data_changes (
           reader_id, event_type, old_value, new_value, actor_id
         ) VALUES ($1, 'employment_end_changed', $2, $3, $4)`,
        [
          readerId,
          JSON.stringify({ employmentEndedOn: oldValue }),
          JSON.stringify({ employmentEndedOn }),
          actorId,
        ],
      );
      await client.query('COMMIT');
      return { status: 'updated', readerId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async anonymizeEligibleReaders({ today, readerId = null }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidates = await client.query(
        `SELECT rpd.reader_id
         FROM reader_personal_data rpd
         WHERE ($1::bigint IS NULL OR rpd.reader_id = $1)
           AND (
             (rpd.category = 'student' AND rpd.ticket_expires_on < $2::date)
             OR (
               rpd.category = 'employee'
               AND rpd.employment_ended_on IS NOT NULL
               AND rpd.employment_ended_on <= $2::date
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM loans l
             WHERE l.reader_id = rpd.reader_id AND l.status IN ('issued', 'lost')
           )
         ORDER BY rpd.reader_id
         FOR UPDATE OF rpd`,
        [readerId, today],
      );

      const anonymized = [];
      for (const candidate of candidates.rows) {
        const id = String(candidate.reader_id);
        const openLoans = await client.query(
          `SELECT 1 FROM loans
           WHERE reader_id = $1 AND status IN ('issued', 'lost')
           LIMIT 1`,
          [id],
        );
        if (openLoans.rowCount) continue;

        await client.query(
          `UPDATE loan_status_events
           SET comment = NULL
           WHERE loan_id IN (SELECT id FROM loans WHERE reader_id = $1)`,
          [id],
        );
        await client.query(
          `UPDATE loan_extensions
           SET reason = 'Видалено під час знеособлення'
           WHERE loan_id IN (SELECT id FROM loans WHERE reader_id = $1)`,
          [id],
        );
        await client.query(
          `UPDATE book_copy_events
           SET reason = NULL
           WHERE loan_id IN (SELECT id FROM loans WHERE reader_id = $1)`,
          [id],
        );
        await client.query(
          'UPDATE reader_record_events SET reason = NULL WHERE reader_id = $1',
          [id],
        );
        await client.query(
          `UPDATE reader_unblock_requests
           SET request_comment = NULL, decision_comment = NULL
           WHERE block_id IN (SELECT id FROM reader_blocks WHERE reader_id = $1)`,
          [id],
        );
        await client.query(
          `UPDATE reader_blocks
           SET resolution_comment = NULL,
               annul_reason = CASE
                 WHEN annulled_at IS NULL THEN NULL
                 ELSE 'Видалено під час знеособлення'
               END
           WHERE reader_id = $1`,
          [id],
        );
        await client.query('DELETE FROM reader_personal_data_changes WHERE reader_id = $1', [id]);
        await client.query('DELETE FROM reader_personal_data WHERE reader_id = $1', [id]);
        const deleted = await client.query(
          `UPDATE readers
           SET personal_data_deleted_at = now()
           WHERE id = $1 AND personal_data_deleted_at IS NULL
           RETURNING personal_data_deleted_at`,
          [id],
        );
        await client.query(
          `INSERT INTO reader_record_events (reader_id, event_type, actor_id, reason)
           VALUES ($1, 'anonymized', NULL, NULL)`,
          [id],
        );
        anonymized.push({
          readerId: id,
          personalDataDeletedAt: deleted.rows[0].personal_data_deleted_at,
        });
      }

      await client.query('COMMIT');
      return anonymized;
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
