import { AppError } from '../../http/app-error.js';

const CONDITIONS = new Set(['good', 'worn', 'damaged']);

function validationError(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані операції.', { fields });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    validationError({ body: 'Передайте JSON-об’єкт.' });
  }
}

function readId(value, field, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors[field] = 'Вкажіть коректний ідентифікатор.';
    return undefined;
  }
  return normalized;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateLoanIssue(input) {
  requireObject(input);
  const errors = {};
  const readerId = readId(input.readerId, 'readerId', errors);
  const copyId = readId(input.copyId, 'copyId', errors);
  let dueDate = null;
  if (input.dueDate !== undefined && input.dueDate !== null && input.dueDate !== '') {
    if (!isValidDate(input.dueDate)) {
      errors.dueDate = 'Вкажіть коректну дату у форматі YYYY-MM-DD.';
    } else {
      dueDate = input.dueDate;
    }
  }
  if (Object.keys(errors).length) validationError(errors);
  return { readerId, copyId, dueDate };
}

export function validateLoanReturn(input) {
  requireObject(input);
  const errors = {};
  if (!CONDITIONS.has(input.condition)) {
    errors.condition = 'Допустимі значення: good, worn або damaged.';
  }
  const description =
    typeof input.defectDescription === 'string'
      ? input.defectDescription.trim().replace(/\s+/gu, ' ')
      : '';
  if (input.condition === 'worn' || input.condition === 'damaged') {
    if (!description) {
      errors.defectDescription = 'Опишіть дефект зношеного або пошкодженого примірника.';
    }
  } else if (
    input.defectDescription !== undefined &&
    input.defectDescription !== null &&
    input.defectDescription !== ''
  ) {
    errors.defectDescription = 'Для стану good опис дефекту не вказується.';
  }
  if (Object.keys(errors).length) validationError(errors);
  return {
    condition: input.condition,
    defectDescription: description || null,
  };
}

export function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}
