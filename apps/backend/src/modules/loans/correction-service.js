import { AppError } from '../../http/app-error.js';
import { validateIdempotencyKey } from './loan-input.js';

const OPERATIONS = new Set([
  'correct_participants',
  'void_loan',
  'correct_fund_loss',
  'settle_fund_loss',
]);

/**
 * Перевіряє команди завідувача для виправлення помилкових операцій.
 */
export class CorrectionService {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * @param {string} operation Тип виправлення.
   * @param {string} entityId Ідентифікатор видачі або примірника.
   * @param {object} input Версія, причина, підтвердження та нові посилання.
   * @param {object} actor Завідувач, який виконує операцію.
   * @param {string} idempotencyKey Ключ захисту від повторного виконання.
   * @returns {Promise<object>} Результат атомарного виправлення.
   */
  async execute(operation, entityId, input, actor, idempotencyKey) {
    if (
      !OPERATIONS.has(operation) ||
      !input ||
      !/^[1-9][0-9]*$/.test(entityId) ||
      !/^[1-9][0-9]*$/.test(String(input.version)) ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.trim().length > 500 ||
      input.confirm !== true ||
      ['readerId', 'copyId'].some(
        (key) => input[key] != null && !/^[1-9][0-9]*$/.test(String(input[key])),
      )
    ) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Перевірте записи, причину та підтвердження операції.',
      );
    }

    return await this.repository.execute(operation, entityId, {
      actorId: actor.id,
      requestKey: validateIdempotencyKey(idempotencyKey),
      version: String(input.version),
      reason: input.reason.trim(),
      readerId: input.readerId == null ? null : String(input.readerId),
      copyId: input.copyId == null ? null : String(input.copyId),
      confirmNoTransfer: input.confirmNoTransfer === true,
    });
  }
}
