import { sendData } from '../../http/response.js';
import { requireAuthentication } from '../auth/auth-guard.js';

export function registerReportRoutes(router, { authService, reportService }) {
  router.get(
    '/api/v1/reports/:reportType',
    requireAuthentication(authService, async ({ response, requestId, params, searchParams }) => {
      const result = await reportService.getReport(params.reportType, searchParams);
      sendData(response, 200, result.items, requestId, result.meta);
    }),
  );
}
