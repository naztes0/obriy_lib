import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication, requireRole } from '../auth/auth-guard.js';

export function registerRestrictionRoutes(router, { authService, restrictionService }) {
  router.get(
    '/api/v1/readers/:readerId/blocks',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const blocks = await restrictionService.listReaderBlocks(params.readerId);
      sendData(response, 200, blocks, requestId);
    }),
  );

  router.post(
    '/api/v1/readers/:readerId/blocks',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
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
