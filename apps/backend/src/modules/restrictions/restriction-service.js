import { AppError } from '../../http/app-error.js';
import {
  validateBlockAnnulment,
  validateBlockConfirmation,
  validateRestrictionIdempotencyKey,
  validateUnblock,
  validateUnblockDecision,
  validateUnblockRequest,
} from './restriction-input.js';

function validateId(value, code) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError(400, code, 'Некоректний ідентифікатор.');
  }
}

function todayInKyiv(now) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function versionConflict() {
  return new AppError(
    409,
    'VERSION_CONFLICT',
    'Запис уже змінився. Оновіть дані та повторіть дію.',
  );
}

const COMMON_ERRORS = {
  block_not_found: [404, 'READER_BLOCK_NOT_FOUND', 'Блокування не знайдено.'],
  block_not_active: [422, 'READER_BLOCK_NOT_ACTIVE', 'Блокування вже не є активним.'],
  indefinite_block: [
    422,
    'INDEFINITE_BLOCK_CANNOT_BE_RESOLVED',
    'Безстрокове блокування не підлягає звичайному розблокуванню.',
  ],
  minimum_period: [
    422,
    'BLOCK_MINIMUM_PERIOD_NOT_ENDED',
    'Мінімальний 30-денний строк блокування ще не завершився.',
  ],
  grounds_remain: [
    422,
    'BLOCK_GROUNDS_REMAIN',
    'Спочатку усуньте всі прострочення та неврегульовані втрати.',
  ],
};

export class RestrictionService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async listReaderBlocks(readerId) {
    validateId(readerId, 'INVALID_READER_ID');
    const blocks = await this.repository.listReaderBlocks(readerId);
    if (blocks === null) throw new AppError(404, 'READER_NOT_FOUND', 'Читача не знайдено.');
    return blocks;
  }

  async confirmBlock(readerId, input, actor, idempotencyKey) {
    validateId(readerId, 'INVALID_READER_ID');
    const values = validateBlockConfirmation(input);
    const requestKey = validateRestrictionIdempotencyKey(idempotencyKey);
    const result = await this.repository.confirmBlock(readerId, {
      ...values,
      today: todayInKyiv(this.now()),
      actorId: actor.id,
      requestKey,
    });
    const errors = {
      reader_not_found: [404, 'READER_NOT_FOUND', 'Читача не знайдено.'],
      loan_not_found: [404, 'LOAN_NOT_FOUND', 'Видачу не знайдено.'],
      loan_reader_mismatch: [
        422,
        'LOAN_READER_MISMATCH',
        'Вказана видача не належить цьому читачеві.',
      ],
      already_blocked: [409, 'READER_ALREADY_BLOCKED', 'Читач уже має активне блокування.'],
      ground_not_reached: [
        422,
        'BLOCK_GROUND_NOT_REACHED',
        'Видача ще не відповідає вибраній підставі блокування.',
      ],
    };
    this.throwMapped(result.status, errors);
    return await this.getBlock(result.blockId);
  }

  async createUnblockRequest(blockId, input, actor, idempotencyKey) {
    validateId(blockId, 'INVALID_READER_BLOCK_ID');
    const values = validateUnblockRequest(input);
    const requestKey = validateRestrictionIdempotencyKey(idempotencyKey);
    const result = await this.repository.createUnblockRequest(blockId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    const errors = {
      ...COMMON_ERRORS,
      request_exists: [
        409,
        'UNBLOCK_REQUEST_ALREADY_EXISTS',
        'Для цього блокування вже є нерозглянутий запит.',
      ],
    };
    this.throwMapped(result.status, errors);
    return await this.getBlock(result.blockId);
  }

  async unblockDirectly(blockId, input, actor, idempotencyKey) {
    validateId(blockId, 'INVALID_READER_BLOCK_ID');
    const values = validateUnblock(input);
    const requestKey = validateRestrictionIdempotencyKey(idempotencyKey);
    const result = await this.repository.unblockDirectly(blockId, {
      ...values,
      today: todayInKyiv(this.now()),
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'version_conflict') throw versionConflict();
    this.throwMapped(result.status, COMMON_ERRORS);
    return await this.getBlock(result.blockId);
  }

  async decideUnblockRequest(requestId, input, actor, idempotencyKey) {
    validateId(requestId, 'INVALID_UNBLOCK_REQUEST_ID');
    const values = validateUnblockDecision(input);
    const requestKey = validateRestrictionIdempotencyKey(idempotencyKey);
    const result = await this.repository.decideUnblockRequest(requestId, {
      ...values,
      today: todayInKyiv(this.now()),
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'version_conflict') throw versionConflict();
    const errors = {
      ...COMMON_ERRORS,
      request_not_found: [404, 'UNBLOCK_REQUEST_NOT_FOUND', 'Запит не знайдено.'],
      request_decided: [422, 'UNBLOCK_REQUEST_ALREADY_DECIDED', 'Запит уже розглянуто.'],
    };
    this.throwMapped(result.status, errors);
    return await this.getBlock(result.blockId);
  }

  async annulBlock(blockId, input, actor, idempotencyKey) {
    validateId(blockId, 'INVALID_READER_BLOCK_ID');
    const values = validateBlockAnnulment(input);
    const requestKey = validateRestrictionIdempotencyKey(idempotencyKey);
    const result = await this.repository.annulBlock(blockId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    if (result.status === 'version_conflict') throw versionConflict();
    const errors = {
      block_not_found: COMMON_ERRORS.block_not_found,
      already_annulled: [422, 'READER_BLOCK_ALREADY_ANNULLED', 'Блокування вже анульовано.'],
    };
    this.throwMapped(result.status, errors);
    return await this.getBlock(result.blockId);
  }

  async getBlock(blockId) {
    const block = await this.repository.findBlockById(blockId);
    if (!block) throw new AppError(404, 'READER_BLOCK_NOT_FOUND', 'Блокування не знайдено.');
    return block;
  }

  throwMapped(status, errors) {
    if (!errors[status]) return;
    const [httpStatus, code, message] = errors[status];
    throw new AppError(httpStatus, code, message);
  }
}
