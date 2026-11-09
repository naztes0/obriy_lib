import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';

export function registerCopyRoutes(router, { authService, copyService }) {
  router.post(
    '/api/v1/books/:bookId/copies',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const input = await readJsonBody(request);
      const copy = await copyService.createCopy(params.bookId, input, actor);
      sendData(response, 201, copy, requestId);
    }),
  );

  router.patch(
    '/api/v1/copies/:copyId/condition',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const input = await readJsonBody(request);
      const copy = await copyService.changeCondition(params.copyId, input, actor);
      sendData(response, 200, copy, requestId);
    }),
  );

  router.patch(
    '/api/v1/copies/:copyId/temporary-unavailability',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const input = await readJsonBody(request);
      const copy = await copyService.setTemporaryUnavailability(params.copyId, input, actor);
      sendData(response, 200, copy, requestId);
    }),
  );

  router.post(
    '/api/v1/copies/:copyId/loss',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const copy = await copyService.markLostInFund(
        params.copyId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, copy, requestId);
    }),
  );

  router.get(
    '/api/v1/copies/:copyId/history',
    requireAuthentication(authService, async ({ response, requestId, params, searchParams }) => {
      const result = await copyService.listHistory(params.copyId, searchParams);
      sendData(response, 200, result.data, requestId, result.meta);
    }),
  );
}
