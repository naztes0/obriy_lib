import { sendData } from '../../http/response.js';
import { readJsonBody } from '../../http/request-body.js';
import { requireAuthentication, requireRole } from '../auth/auth-guard.js';

export function registerCatalogRoutes(router, { authService, catalogService }) {
  router.get(
    '/api/v1/books',
    requireAuthentication(authService, async ({ response, requestId, searchParams }) => {
      const result = await catalogService.listBooks(searchParams);
      sendData(response, 200, result.data, requestId, result.meta);
    }),
  );

  router.get(
    '/api/v1/books/:bookId',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const book = await catalogService.getBook(params.bookId);
      sendData(response, 200, book, requestId);
    }),
  );

  router.post(
    '/api/v1/books',
    requireAuthentication(authService, async ({ request, response, requestId }) => {
      const input = await readJsonBody(request);
      const book = await catalogService.createBook(input);
      sendData(response, 201, book, requestId);
    }),
  );

  router.patch(
    '/api/v1/books/:bookId',
    requireAuthentication(authService, async ({ request, response, requestId, params }) => {
      const input = await readJsonBody(request);
      const book = await catalogService.updateBook(params.bookId, input);
      sendData(response, 200, book, requestId);
    }),
  );

  router.post(
    '/api/v1/books/:bookId/archive',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const book = await catalogService.archiveBook(
        params.bookId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, book, requestId);
    }),
  );

  router.post(
    '/api/v1/books/:bookId/restore',
    requireRole(
      authService,
      ['manager'],
      async ({ request, response, requestId, params, actor }) => {
        const book = await catalogService.restoreBook(
          params.bookId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 200, book, requestId);
      },
    ),
  );

  router.post(
    '/api/v1/books/:bookId/delete',
    requireRole(
      authService,
      ['manager'],
      async ({ request, response, requestId, params, actor }) => {
        const result = await catalogService.deleteUnusedBook(
          params.bookId,
          await readJsonBody(request),
          actor,
          request.headers['idempotency-key'],
        );
        sendData(response, 200, result, requestId);
      },
    ),
  );
}
