function parseEventValue(value) {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapCopy(row) {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    inventoryNumber: row.inventory_number,
    condition: row.condition,
    defectDescription: row.defect_description,
    isTemporarilyUnavailable: row.is_temporarily_unavailable,
    isLost: row.is_lost,
    isArchived: row.archived_at !== null,
    isAvailable: row.availability_reasons.length === 0,
    availabilityReasons: row.availability_reasons,
    version: String(row.version),
  };
}

const COPY_SELECT = `SELECT bc.id, bc.book_id, bc.inventory_number, bc.condition,
                            bc.defect_description, bc.is_temporarily_unavailable,
                            bc.is_lost, bc.archived_at, bc.version,
                            ARRAY_REMOVE(ARRAY[
                              CASE WHEN b.archived_at IS NOT NULL THEN 'book_archived' END,
                              CASE WHEN bc.archived_at IS NOT NULL THEN 'copy_archived' END,
                              CASE WHEN bc.is_lost THEN 'lost' END,
                              CASE WHEN bc.is_temporarily_unavailable THEN 'temporarily_unavailable' END,
                              CASE WHEN bc.condition = 'damaged' THEN 'damaged' END,
                              CASE WHEN bc.condition = 'unrecorded' THEN 'condition_unrecorded' END,
                              CASE WHEN EXISTS (
                                SELECT 1 FROM loans l
                                WHERE l.copy_id = bc.id AND l.status IN ('issued', 'lost')
                              ) THEN 'on_loan' END
                            ]::text[], NULL) AS availability_reasons
                     FROM book_copies bc
                     JOIN books b ON b.id = bc.book_id`;

async function insertEvent(client, { copyId, kind, oldValue, newValue, reason, actorId }) {
  await client.query(
    `INSERT INTO book_copy_events (copy_id, kind, old_value, new_value, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      copyId,
      kind,
      oldValue === null ? null : JSON.stringify(oldValue),
      newValue === null ? null : JSON.stringify(newValue),
      reason,
      actorId,
    ],
  );
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

export class CopyRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findCopyById(copyId) {
    const result = await this.pool.query(`${COPY_SELECT} WHERE bc.id = $1`, [copyId]);
    return result.rowCount ? mapCopy(result.rows[0]) : null;
  }

  async createCopy({ bookId, inventoryNumber, condition, defectDescription, actorId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const book = await client.query('SELECT archived_at FROM books WHERE id = $1 FOR UPDATE', [bookId]);
      if (!book.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'book_not_found' };
      }
      if (book.rows[0].archived_at !== null) {
        await client.query('ROLLBACK');
        return { status: 'book_archived' };
      }

      const result = await client.query(
        `INSERT INTO book_copies (book_id, inventory_number, condition, defect_description)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [bookId, inventoryNumber, condition, defectDescription],
      );
      const copyId = String(result.rows[0].id);
      await insertEvent(client, {
        copyId,
        kind: 'created',
        oldValue: null,
        newValue: { inventoryNumber, condition, defectDescription },
        reason: null,
        actorId,
      });
      await client.query('COMMIT');
      return { status: 'created', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async changeCondition(copyId, { condition, defectDescription, reason, actorId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT bc.condition, bc.defect_description, bc.archived_at, b.archived_at AS book_archived_at
         FROM book_copies bc JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1 FOR UPDATE OF bc`,
        [copyId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      const row = current.rows[0];
      if (row.archived_at !== null || row.book_archived_at !== null) {
        await client.query('ROLLBACK');
        return { status: 'archived' };
      }
      if (row.condition === condition && row.defect_description === defectDescription) {
        await client.query('COMMIT');
        return { status: 'unchanged' };
      }

      await client.query(
        `UPDATE book_copies
         SET condition = $2, defect_description = $3, version = version + 1
         WHERE id = $1`,
        [copyId, condition, defectDescription],
      );
      await insertEvent(client, {
        copyId,
        kind: 'condition_changed',
        oldValue: { condition: row.condition, defectDescription: row.defect_description },
        newValue: { condition, defectDescription },
        reason,
        actorId,
      });
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setTemporaryUnavailability(copyId, { isTemporarilyUnavailable, reason, actorId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT bc.is_temporarily_unavailable, bc.archived_at, b.archived_at AS book_archived_at
         FROM book_copies bc JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1 FOR UPDATE OF bc`,
        [copyId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      const row = current.rows[0];
      if (row.archived_at !== null || row.book_archived_at !== null) {
        await client.query('ROLLBACK');
        return { status: 'archived' };
      }
      if (row.is_temporarily_unavailable === isTemporarilyUnavailable) {
        await client.query('COMMIT');
        return { status: 'unchanged' };
      }

      await client.query(
        `UPDATE book_copies
         SET is_temporarily_unavailable = $2, version = version + 1
         WHERE id = $1`,
        [copyId, isTemporarilyUnavailable],
      );
      await insertEvent(client, {
        copyId,
        kind: 'temporary_unavailability_changed',
        oldValue: { isTemporarilyUnavailable: row.is_temporarily_unavailable },
        newValue: { isTemporarilyUnavailable },
        reason,
        actorId,
      });
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markLostInFund(copyId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `lose_copy_in_fund:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }

      const current = await client.query(
        `SELECT bc.id, bc.is_lost, bc.archived_at, bc.version,
                b.archived_at AS book_archived_at
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1
         FOR UPDATE OF bc`,
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (row.archived_at !== null || row.book_archived_at !== null) {
        return await this.rollbackStatus(client, 'archived');
      }
      if (row.is_lost) return await this.rollbackStatus(client, 'already_lost');
      if (String(row.version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }

      const openLoan = await client.query(
        `SELECT id FROM loans
         WHERE copy_id = $1 AND status IN ('issued', 'lost')
         LIMIT 1`,
        [copyId],
      );
      if (openLoan.rowCount) return await this.rollbackStatus(client, 'copy_on_loan');

      await client.query(
        `UPDATE book_copies
         SET is_lost = true, version = version + 1
         WHERE id = $1`,
        [copyId],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, request_key, loan_id
         ) VALUES ($1, 'lost_in_fund', $2, $3, $4, $5, $6, NULL)`,
        [
          copyId,
          JSON.stringify({ isLost: false }),
          JSON.stringify({ isLost: true }),
          reason,
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'lost', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveCopy(copyId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `archive_copy:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        'SELECT archived_at, version FROM book_copies WHERE id = $1 FOR UPDATE',
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (row.archived_at !== null) return await this.rollbackStatus(client, 'already_archived');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      const openLoan = await client.query(
        `SELECT 1 FROM loans
         WHERE copy_id = $1 AND status IN ('issued', 'lost')
         LIMIT 1`,
        [copyId],
      );
      if (openLoan.rowCount) return await this.rollbackStatus(client, 'open_loan');

      await client.query(
        `UPDATE book_copies SET archived_at = now(), version = version + 1 WHERE id = $1`,
        [copyId],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, request_key
         ) VALUES ($1, 'archived', $2, $3, $4, $5, $6)`,
        [
          copyId,
          JSON.stringify({ isArchived: false }),
          JSON.stringify({ isArchived: true }),
          reason,
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'archived', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreCopy(copyId, { version, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `restore_copy:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT bc.archived_at, bc.version, b.archived_at AS book_archived_at
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1
         FOR UPDATE OF bc, b`,
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (row.archived_at === null) return await this.rollbackStatus(client, 'not_archived');
      if (row.book_archived_at !== null) return await this.rollbackStatus(client, 'book_archived');
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');

      await client.query(
        `UPDATE book_copies SET archived_at = NULL, version = version + 1 WHERE id = $1`,
        [copyId],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, actor_id, request_key
         ) VALUES ($1, 'restored', $2, $3, $4, $5)`,
        [
          copyId,
          JSON.stringify({ isArchived: true }),
          JSON.stringify({ isArchived: false }),
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'restored', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteUnusedCopy(copyId, { version, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `delete_unused_copy:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        'SELECT is_lost, version FROM book_copies WHERE id = $1 FOR UPDATE',
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      const loans = await client.query('SELECT 1 FROM loans WHERE copy_id = $1 LIMIT 1', [copyId]);
      if (loans.rowCount) return await this.rollbackStatus(client, 'has_loans');
      if (row.is_lost) return await this.rollbackStatus(client, 'unresolved_loss');

      await client.query('DELETE FROM book_copies WHERE id = $1', [copyId]);
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'deleted', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async correctInventoryNumber(
    copyId,
    { version, inventoryNumber, reason, actorId, requestKey },
  ) {
    const client = await this.pool.connect();
    const operation = `correct_inventory_number:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        'SELECT inventory_number, version FROM book_copies WHERE id = $1 FOR UPDATE',
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      if (row.inventory_number === inventoryNumber) return await this.rollbackStatus(client, 'unchanged');

      await client.query(
        `UPDATE book_copies
         SET inventory_number = $2, version = version + 1
         WHERE id = $1`,
        [copyId, inventoryNumber],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, request_key
         ) VALUES ($1, 'inventory_number_corrected', $2, $3, $4, $5, $6)`,
        [
          copyId,
          JSON.stringify({ inventoryNumber: row.inventory_number }),
          JSON.stringify({ inventoryNumber }),
          reason,
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'corrected', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async writeOffCopy(copyId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `write_off_copy:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT inventory_number, is_lost, version
         FROM book_copies WHERE id = $1 FOR UPDATE`,
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      const openLoan = await client.query(
        `SELECT 1 FROM loans
         WHERE copy_id = $1 AND status IN ('issued', 'lost')
         LIMIT 1`,
        [copyId],
      );
      if (openLoan.rowCount) return await this.rollbackStatus(client, 'open_loan');

      if (row.is_lost) {
        const loss = await client.query(
          `SELECT e.kind, l.status AS loan_status
           FROM book_copy_events e
           LEFT JOIN loans l ON l.id = e.loan_id
           WHERE e.copy_id = $1
             AND e.kind IN ('lost', 'lost_in_fund', 'erroneous_return', 'found', 'returned')
           ORDER BY e.occurred_at DESC, e.id DESC
           LIMIT 1`,
          [copyId],
        );
        const settled =
          loss.rowCount && loss.rows[0].kind === 'lost' && loss.rows[0].loan_status === 'compensated';
        if (!settled) return await this.rollbackStatus(client, 'unresolved_loss');
      }

      const deletedLoans = await client.query(
        'DELETE FROM loans WHERE copy_id = $1 RETURNING id',
        [copyId],
      );
      await client.query('DELETE FROM book_copies WHERE id = $1', [copyId]);
      await client.query(
        `INSERT INTO inventory_write_off_audit (
           former_copy_id, former_inventory_number, reason, actor_id,
           deleted_loan_count, request_key
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [copyId, row.inventory_number, reason, actorId, deletedLoans.rowCount, requestKey],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'written_off', copyId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async changeBook(copyId, { version, bookId, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `change_copy_book:${copyId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', copyId: reservation.resultId };
      }
      const current = await client.query(
        `SELECT bc.book_id, bc.archived_at, bc.version,
                b.title AS book_title, b.archived_at AS book_archived_at
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         WHERE bc.id = $1
         FOR UPDATE OF bc`,
        [copyId],
      );
      if (!current.rowCount) return await this.rollbackStatus(client, 'not_found');
      const row = current.rows[0];
      if (row.archived_at !== null || row.book_archived_at !== null) {
        return await this.rollbackStatus(client, 'archived');
      }
      if (String(row.version) !== version) return await this.rollbackStatus(client, 'version_conflict');
      if (String(row.book_id) === bookId) return await this.rollbackStatus(client, 'same_book');
      const history = await client.query('SELECT 1 FROM loans WHERE copy_id = $1 LIMIT 1', [copyId]);
      if (history.rowCount) return await this.rollbackStatus(client, 'has_loans');

      const target = await client.query(
        'SELECT title, archived_at FROM books WHERE id = $1 FOR UPDATE',
        [bookId],
      );
      if (!target.rowCount) return await this.rollbackStatus(client, 'book_not_found');
      if (target.rows[0].archived_at !== null) {
        return await this.rollbackStatus(client, 'book_archived');
      }

      await client.query(
        `UPDATE book_copies SET book_id = $2, version = version + 1 WHERE id = $1`,
        [copyId, bookId],
      );
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, reason, actor_id, request_key
         ) VALUES ($1, 'book_changed', $2, $3, $4, $5, $6)`,
        [
          copyId,
          JSON.stringify({ bookId: String(row.book_id), title: row.book_title }),
          JSON.stringify({ bookId, title: target.rows[0].title }),
          reason,
          actorId,
          requestKey,
        ],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: copyId });
      await client.query('COMMIT');
      return { status: 'changed', copyId };
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

  async listHistory(copyId, { pageSize, offset }) {
    const count = await this.pool.query(
      'SELECT count(*) AS total FROM book_copy_events WHERE copy_id = $1',
      [copyId],
    );
    const result = await this.pool.query(
      `SELECT e.id, e.kind, e.old_value, e.new_value, e.reason, e.occurred_at,
              e.actor_id, COALESCE(s.display_name, e.performed_by_snapshot) AS actor_display_name,
              e.loan_id
       FROM book_copy_events e
       LEFT JOIN staff_accounts s ON s.id = e.actor_id
       WHERE e.copy_id = $1
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT $2 OFFSET $3`,
      [copyId, pageSize, offset],
    );
    return {
      events: result.rows.map((row) => ({
        id: String(row.id),
        kind: row.kind,
        oldValue: parseEventValue(row.old_value),
        newValue: parseEventValue(row.new_value),
        reason: row.reason,
        occurredAt: row.occurred_at,
        actor: row.actor_display_name
          ? {
              id: row.actor_id === null ? null : String(row.actor_id),
              displayName: row.actor_display_name,
            }
          : null,
        loanId: row.loan_id === null ? null : String(row.loan_id),
      })),
      totalItems: Number(count.rows[0].total),
    };
  }
}
