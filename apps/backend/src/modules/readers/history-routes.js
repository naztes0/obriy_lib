import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';

export function registerHistoryRoutes(router, { authService, historyService }) {
  router.get('/api/v1/readers/:readerId/history', requireAuthentication(authService, async ({ params, searchParams, response, requestId }) => {
    const result = await historyService.listReaderHistory(params.readerId, searchParams);
    sendData(response, 200, result.data, requestId, result.meta);
  }));
  router.get('/api/v1/loans/:loanId/audit', requireAuthentication(authService, async ({ params, response, requestId }) => {
    const audit = await historyService.listLoanAudit(params.loanId);
    sendData(response, 200, audit, requestId);
  }));
}
