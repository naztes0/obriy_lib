import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireRole } from '../auth/auth-guard.js';

export function registerCorrectionRoutes(router, { authService, correctionService }) {
  for (const [path, operation] of [
    ['/api/v1/loans/:id/correct-participants', 'correct_participants'],
    ['/api/v1/loans/:id/void', 'void_loan'],
    ['/api/v1/copies/:id/correct-loss', 'correct_fund_loss'],
    ['/api/v1/copies/:id/settle-loss', 'settle_fund_loss'],
  ]) {
    router.post(path, requireRole(authService, ['manager'], async ({ request, response, params, actor, requestId }) => {
      const result = await correctionService.execute(
        operation,
        params.id,
        await readJsonBody(request),
        actor,
        request.headers['idempotency-key'],
      );
      sendData(response, 200, result, requestId);
    }));
  }
}
