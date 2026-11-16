/**
 * Читає з PostgreSQL історію видач читача та журнал виправлень.
 */
export class HistoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listReaderHistory(readerId, { dateFrom, dateTo, pageSize, offset }) {
    const values = [readerId, dateFrom, dateTo];
    const where = `l.reader_id = $1
      AND ($2::date IS NULL OR (l.issued_at AT TIME ZONE 'Europe/Kyiv')::date >= $2::date)
      AND ($3::date IS NULL OR (l.issued_at AT TIME ZONE 'Europe/Kyiv')::date <= $3::date)`;
    const count = await this.pool.query(`SELECT count(*) FROM loans l WHERE ${where}`, values);
    const rows = await this.pool.query(
      `SELECT l.id::text, l.status, l.issued_at AS "issuedAt",
              l.current_due_date::text AS "currentDueDate", b.title,
              bc.inventory_number AS "inventoryNumber", issuer.display_name AS "issuedBy",
              (
                SELECT coalesce(json_agg(events ORDER BY events."occurredAt" DESC), '[]')
                FROM (
                  SELECT e.kind, e.occurred_at AS "occurredAt", e.reason,
                         e.old_value AS "oldValue", e.new_value AS "newValue",
                         coalesce(s.display_name, e.performed_by_snapshot) AS actor
                  FROM book_copy_events e
                  LEFT JOIN staff_accounts s ON s.id = e.actor_id
                  WHERE e.loan_id = l.id
                ) events
              ) AS events
       FROM loans l
       JOIN book_copies bc ON bc.id = l.copy_id
       JOIN books b ON b.id = bc.book_id
       LEFT JOIN staff_accounts issuer ON issuer.id = l.issued_by
       WHERE ${where}
       ORDER BY l.issued_at DESC, l.id DESC
       LIMIT $4 OFFSET $5`,
      [...values, pageSize, offset],
    );
    return { items: rows.rows, totalItems: Number(count.rows[0].count) };
  }

  async listLoanAudit(loanId) {
    const result = await this.pool.query(
      `SELECT c.id::text, c.operation, c.reason, c.old_value AS "oldValue",
              c.new_value AS "newValue", c.occurred_at AS "occurredAt",
              s.display_name AS actor
       FROM operation_corrections c
       LEFT JOIN staff_accounts s ON s.id = c.actor_id
       WHERE c.entity_id = $1
         AND c.operation IN ('correct_participants', 'void_loan')
       ORDER BY c.occurred_at DESC`,
      [loanId],
    );
    return result.rows;
  }
}
