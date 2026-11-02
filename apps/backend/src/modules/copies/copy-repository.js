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

  async listHistory(copyId, { pageSize, offset }) {
    const count = await this.pool.query(
      'SELECT count(*) AS total FROM book_copy_events WHERE copy_id = $1',
      [copyId],
    );
    const result = await this.pool.query(
      `SELECT e.id, e.kind, e.old_value, e.new_value, e.reason, e.occurred_at,
              e.actor_id, s.display_name AS actor_display_name, e.loan_id
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
        actor: row.actor_id
          ? { id: String(row.actor_id), displayName: row.actor_display_name }
          : null,
        loanId: row.loan_id === null ? null : String(row.loan_id),
      })),
      totalItems: Number(count.rows[0].total),
    };
  }
}
