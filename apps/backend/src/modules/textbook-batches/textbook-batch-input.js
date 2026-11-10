import { AppError } from '../../http/app-error.js';
import { isValidDate } from '../loans/loan-input.js';

const MAXIMUM_BATCH_SIZE = 500;

function validationError(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані пакета видач.', { fields });
}

function readId(value, field, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors[field] = 'Передайте коректний ідентифікатор.';
    return undefined;
  }
  return normalized;
}

export function validateTextbookBatch(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    validationError({ body: 'Передайте JSON-об’єкт.' });
  }
  const errors = {};
  const classId = readId(input.classId, 'classId', errors);
  if (!isValidDate(input.dueDate)) {
    errors.dueDate = 'Вкажіть коректну дату у форматі YYYY-MM-DD.';
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.items = 'Додайте щонайменше одну видачу.';
  } else if (input.items.length > MAXIMUM_BATCH_SIZE) {
    errors.items = `Один пакет може містити не більше ${MAXIMUM_BATCH_SIZE} видач.`;
  }

  const items = Array.isArray(input.items)
    ? input.items.map((item, index) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          errors[`items.${index}`] = 'Передайте JSON-об’єкт.';
          return { readerId: undefined, copyId: undefined };
        }
        return {
          readerId: readId(item.readerId, `items.${index}.readerId`, errors),
          copyId: readId(item.copyId, `items.${index}.copyId`, errors),
        };
      })
    : [];

  if (Object.keys(errors).length) validationError(errors);
  return { classId, dueDate: input.dueDate, items };
}

export function validateBatchIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}
