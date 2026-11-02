import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';

export function registerReaderRoutes(router, { authService, readerService }) {
  router.get(
    '/api/v1/readers',
    requireAuthentication(authService, async ({ response, requestId, searchParams }) => {
      const result = await readerService.listReaders(searchParams);
      sendData(response, 200, result.data, requestId, result.meta);
    }),
  );

  router.get(
    '/api/v1/readers/:readerId',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const reader = await readerService.getReader(params.readerId);
      sendData(response, 200, reader, requestId);
    }),
  );

  router.post(
    '/api/v1/readers',
    requireAuthentication(authService, async ({ request, response, requestId, actor }) => {
      const reader = await readerService.createReader(await readJsonBody(request), actor);
      sendData(response, 201, reader, requestId);
    }),
  );

  router.patch(
    '/api/v1/readers/:readerId',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const reader = await readerService.updateReader(
        params.readerId,
        await readJsonBody(request),
        actor,
      );
      sendData(response, 200, reader, requestId);
    }),
  );
}
