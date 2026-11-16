import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication, requireRole } from '../auth/auth-guard.js';
import { readPagination } from '../../http/pagination.js';

export function registerRestrictionRoutes(router, { authService, restrictionService, pool }) {
  router.get('/api/v1/restrictions', requireAuthentication(authService, async ({ searchParams, response, requestId }) => {
    const pagination = readPagination(searchParams);
    const pending = searchParams.get('pending') === 'true';
    const where = `rb.resolved_at IS NULL AND rb.annulled_at IS NULL ${pending ? 'AND EXISTS (SELECT 1 FROM reader_unblock_requests ur WHERE ur.block_id=rb.id AND ur.decision IS NULL)' : ''}`;
    const count = await pool.query(`SELECT count(*) FROM reader_blocks rb WHERE ${where}`);
    const result = await pool.query(`SELECT rb.id::text,rb.reader_id::text AS "readerId",rpd.full_name AS "fullName",rpd.ticket_number AS "ticketNumber",
      rb.reason_code AS "reasonCode",rb.minimum_until::text AS "minimumUntil",rb.is_indefinite AS "isIndefinite",
      EXISTS(SELECT 1 FROM reader_unblock_requests ur WHERE ur.block_id=rb.id AND ur.decision IS NULL) AS "hasPendingRequest"
      FROM reader_blocks rb LEFT JOIN reader_personal_data rpd ON rpd.reader_id=rb.reader_id WHERE ${where}
      ORDER BY "hasPendingRequest" DESC,rb.confirmed_at,rb.id LIMIT $1 OFFSET $2`,[pagination.pageSize,pagination.offset]);
    const totalItems=Number(count.rows[0].count);
    sendData(response,200,result.rows,requestId,{page:pagination.page,pageSize:pagination.pageSize,totalItems,totalPages:Math.ceil(totalItems/pagination.pageSize)});
  }));
  router.get(
    '/api/v1/readers/:readerId/blocks',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const blocks = await restrictionService.listReaderBlocks(params.readerId);
      sendData(response, 200, blocks, requestId);
    }),
  );

  router.post(
    '/api/v1/readers/:readerId/blocks',
    requireRole(authService, ['manager'], async ({ request, response, requestId, params, actor }) => {
      const block = await restrictionService.confirmBlock(
        params.readerId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 201, block, requestId);
    }),
  );

  router.post(
    '/api/v1/reader-blocks/:blockId/unblock-requests',
    requireRole(
      authService,
      ['librarian'],
      async ({ request, response, requestId, params, actor }) => {
        const block = await restrictionService.createUnblockRequest(
          params.blockId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 201, block, requestId);
      },
    ),
  );

  router.post(
    '/api/v1/reader-blocks/:blockId/unblock',
    requireRole(
      authService,
      ['manager'],
      async ({ request, response, requestId, params, actor }) => {
        const block = await restrictionService.unblockDirectly(
          params.blockId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 200, block, requestId);
      },
    ),
  );

  router.post(
    '/api/v1/reader-unblock-requests/:requestId/decision',
    requireRole(
      authService,
      ['manager'],
      async ({ request, response, requestId, params, actor }) => {
        const block = await restrictionService.decideUnblockRequest(
          params.requestId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 200, block, requestId);
      },
    ),
  );

  router.post(
    '/api/v1/reader-blocks/:blockId/annul',
    requireRole(
      authService,
      ['manager'],
      async ({ request, response, requestId, params, actor }) => {
        const block = await restrictionService.annulBlock(
          params.blockId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 200, block, requestId);
      },
    ),
  );
}
