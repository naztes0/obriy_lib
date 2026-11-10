import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';

export function registerTextbookBatchRoutes(router, { authService, textbookBatchService }) {
  router.post(
    '/api/v1/textbook-issue-batches/preview',
    requireAuthentication(authService, async ({ request, response, requestId }) => {
      const preview = await textbookBatchService.previewBatch(await readJsonBody(request));
      sendData(response, 200, preview, requestId);
    }),
  );

  router.post(
    '/api/v1/textbook-issue-batches',
    requireAuthentication(authService, async ({ request, response, requestId, actor }) => {
      const batch = await textbookBatchService.createBatch(
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, batch.wasRepeated ? 200 : 201, batch, requestId);
    }),
  );

  router.get(
    '/api/v1/textbook-issue-batches/:batchId',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const batch = await textbookBatchService.getBatch(params.batchId);
      sendData(response, 200, batch, requestId);
    }),
  );
}
