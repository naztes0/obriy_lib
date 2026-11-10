import { AppError } from '../../http/app-error.js';
import {
  validateBatchIdempotencyKey,
  validateTextbookBatch,
} from './textbook-batch-input.js';

function dateInKyiv(now) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validateBatchId(batchId) {
  if (!/^[1-9][0-9]*$/.test(batchId)) {
    throw new AppError(400, 'INVALID_BATCH_ID', 'Некоректний ідентифікатор пакета.');
  }
}

function assertPackageState(result) {
  if (result.status === 'class_not_found') {
    throw new AppError(404, 'CLASS_NOT_FOUND', 'Клас не знайдено.');
  }
  if (result.status === 'class_inactive') {
    throw new AppError(422, 'CLASS_INACTIVE', 'Неактивний клас не можна використати у видачі.');
  }
}

export class TextbookBatchService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async previewBatch(input) {
    const values = validateTextbookBatch(input);
    const issueDate = dateInKyiv(this.now());
    if (values.dueDate < issueDate) {
      throw new AppError(
        422,
        'INVALID_DUE_DATE',
        'Спільний строк повернення не може бути в минулому.',
      );
    }
    const result = await this.repository.previewBatch({ ...values, issueDate });
    assertPackageState(result);
    return result.preview;
  }

  async createBatch(input, actor, idempotencyKey) {
    const values = validateTextbookBatch(input);
    const requestKey = validateBatchIdempotencyKey(idempotencyKey);
    const existingBatchId = await this.repository.findBatchIdByRequest(actor.id, requestKey);
    if (existingBatchId !== null) {
      const batch = await this.getBatch(existingBatchId);
      return { ...batch, wasRepeated: true };
    }
    const issueDate = dateInKyiv(this.now());
    if (values.dueDate < issueDate) {
      throw new AppError(
        422,
        'INVALID_DUE_DATE',
        'Спільний строк повернення не може бути в минулому.',
      );
    }
    const result = await this.repository.createBatch(
      { ...values, issueDate },
      { actorId: actor.id, requestKey },
    );
    assertPackageState(result);
    if (result.status === 'validation_failed') {
      throw new AppError(
        422,
        'BATCH_VALIDATION_FAILED',
        'Пакет змінився або містить недоступні рядки.',
        result.preview,
      );
    }
    if (result.status === 'state_changed') {
      throw new AppError(
        409,
        'BATCH_STATE_CHANGED',
        'Стан одного з примірників змінився. Оновіть попередній перегляд.',
      );
    }
    const batch = await this.getBatch(result.batchId);
    return { ...batch, wasRepeated: result.status === 'repeated' };
  }

  async getBatch(batchId) {
    validateBatchId(batchId);
    const batch = await this.repository.findBatchById(batchId);
    if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Пакет видач не знайдено.');
    return batch;
  }
}
