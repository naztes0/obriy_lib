import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication, requireRole } from '../auth/auth-guard.js';

export function registerLoanRoutes(router, { authService, loanService }) {
  router.get(
    '/api/v1/loans/:loanId',
    requireAuthentication(authService, async ({ response, requestId, params }) => {
      const loan = await loanService.getLoan(params.loanId);
      sendData(response, 200, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/loans',
    requireAuthentication(authService, async ({ request, response, requestId, actor }) => {
      const loan = await loanService.issueLoan(
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 201, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/loans/:loanId/return',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const loan = await loanService.returnLoan(
        params.loanId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/loans/:loanId/extend',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const loan = await loanService.extendLoan(
        params.loanId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/loans/:loanId/loss',
    requireAuthentication(authService, async ({ request, response, requestId, params, actor }) => {
      const loan = await loanService.markLoanLost(
        params.loanId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/loans/:loanId/compensate',
    requireRole(authService, ['manager'], async ({ request, response, requestId, params, actor }) => {
      const loan = await loanService.compensateLoan(
        params.loanId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, loan, requestId);
    }),
  );

  router.post(
    '/api/v1/copies/:copyId/found',
    requireRole(authService, ['manager'], async ({ request, response, requestId, params, actor }) => {
      const copy = await loanService.markCopyFound(
        params.copyId,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, copy, requestId);
    }),
  );
}
