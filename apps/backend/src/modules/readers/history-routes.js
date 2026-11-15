import { AppError } from '../../http/app-error.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';
import { readReportQuery } from '../reports/report-input.js';

export function registerHistoryRoutes(router, { authService, pool }) {
  router.get('/api/v1/readers/:readerId/history', requireAuthentication(authService, async ({ params, searchParams, response, requestId }) => {
    if (!/^[1-9][0-9]*$/.test(params.readerId)) throw new AppError(400, 'INVALID_READER_ID', 'Некоректний читач.');
    const { filters, pagination } = readReportQuery('reader-activity', searchParams);
    const values = [params.readerId, filters.dateFrom, filters.dateTo];
    const where = `l.reader_id=$1 AND ($2::date IS NULL OR (l.issued_at AT TIME ZONE 'Europe/Kyiv')::date >= $2::date)
      AND ($3::date IS NULL OR (l.issued_at AT TIME ZONE 'Europe/Kyiv')::date <= $3::date)`;
    const count = await pool.query(`SELECT count(*) FROM loans l WHERE ${where}`, values);
    const rows = await pool.query(`SELECT l.id::text,l.status,l.issued_at AS "issuedAt",l.current_due_date::text AS "currentDueDate",
      b.title,bc.inventory_number AS "inventoryNumber",issuer.display_name AS "issuedBy",
      (SELECT coalesce(json_agg(events ORDER BY events."occurredAt" DESC),'[]') FROM (
        SELECT e.kind,e.occurred_at AS "occurredAt",e.reason,e.old_value AS "oldValue",e.new_value AS "newValue",
          coalesce(s.display_name,e.performed_by_snapshot) AS actor
        FROM book_copy_events e LEFT JOIN staff_accounts s ON s.id=e.actor_id WHERE e.loan_id=l.id
      ) events) AS events
      FROM loans l JOIN book_copies bc ON bc.id=l.copy_id JOIN books b ON b.id=bc.book_id
      LEFT JOIN staff_accounts issuer ON issuer.id=l.issued_by WHERE ${where}
      ORDER BY l.issued_at DESC,l.id DESC LIMIT $4 OFFSET $5`, [...values,pagination.pageSize,pagination.offset]);
    const totalItems = Number(count.rows[0].count);
    sendData(response,200,rows.rows,requestId,{page:pagination.page,pageSize:pagination.pageSize,totalItems,totalPages:Math.ceil(totalItems/pagination.pageSize)});
  }));
  router.get('/api/v1/loans/:loanId/audit', requireAuthentication(authService, async ({ params, response, requestId }) => {
    if (!/^[1-9][0-9]*$/.test(params.loanId)) throw new AppError(400,'INVALID_LOAN_ID','Некоректна видача.');
    const rows = await pool.query(`SELECT c.id::text,c.operation,c.reason,c.old_value AS "oldValue",c.new_value AS "newValue",
      c.occurred_at AS "occurredAt",s.display_name AS actor FROM operation_corrections c
      LEFT JOIN staff_accounts s ON s.id=c.actor_id WHERE c.entity_id=$1 AND c.operation IN ('correct_participants','void_loan') ORDER BY c.occurred_at DESC`, [params.loanId]);
    sendData(response,200,rows.rows,requestId);
  }));
}
