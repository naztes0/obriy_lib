import { AppError } from '../../http/app-error.js';
import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireRole } from '../auth/auth-guard.js';
import { validateIdempotencyKey } from './loan-input.js';
import { CorrectionRepository } from './correction-repository.js';

export function registerCorrectionRoutes(router, { authService, pool }) {
  const repository = new CorrectionRepository(pool);
  for (const [path, operation] of [
    ['/api/v1/loans/:id/correct-participants', 'correct_participants'],
    ['/api/v1/loans/:id/void', 'void_loan'],
    ['/api/v1/copies/:id/correct-loss', 'correct_fund_loss'],
    ['/api/v1/copies/:id/settle-loss', 'settle_fund_loss'],
  ]) {
    router.post(path, requireRole(authService, ['manager'], async ({ request, response, params, actor, requestId }) => {
      const input = await readJsonBody(request);
      if (!input || !/^[1-9][0-9]*$/.test(params.id) || !/^[1-9][0-9]*$/.test(String(input.version)) ||
          typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500 || input.confirm !== true ||
          ['readerId','copyId'].some((key) => input[key] != null && !/^[1-9][0-9]*$/.test(String(input[key])))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте записи, причину та підтвердження операції.');
      }
      const result = await repository.execute(operation, params.id, {
        actorId: actor.id, requestKey: validateIdempotencyKey(request.headers['idempotency-key']),
        version: String(input.version), reason: input.reason.trim(), readerId: input.readerId == null ? null : String(input.readerId),
        copyId: input.copyId == null ? null : String(input.copyId), confirmNoTransfer: input.confirmNoTransfer === true,
      });
      sendData(response, 200, result, requestId);
    }));
  }
}
