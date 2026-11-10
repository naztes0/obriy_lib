import { AppError } from '../../http/app-error.js';

const CONDITIONS = new Set(['good', 'worn', 'damaged']);
const LOAN_STATUSES = new Set(['issued', 'lost', 'returned', 'compensated']);

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

function readVersion(value, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors.version = 'Передайте поточну додатну версію запису.';
    return undefined;
  }
  return normalized;
}

function readReason(value, field, errors) {
  if (typeof value !== 'string') {
    errors[field] = 'Вкажіть причину.';
    return undefined;
  }
  const result = value.trim().replace(/\s+/gu, ' ');
  if (!result || result.length > 500) {
    errors[field] = 'Вкажіть причину довжиною від 1 до 500 символів.';
    return undefined;
  }
  return result;
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
  const version = readVersion(input.version, errors);
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
    version,
    condition: input.condition,
    defectDescription: description || null,
  };
}

export function validateLoanExtension(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  if (!isValidDate(input.newDueDate)) {
    errors.newDueDate = 'Вкажіть коректну дату у форматі YYYY-MM-DD.';
  }
  const reason = readReason(input.reason, 'reason', errors);
  if (Object.keys(errors).length) validationError(errors);
  return { version, newDueDate: input.newDueDate, reason };
}

export function validateLoanStatusChange(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  let comment = null;
  if (input.comment !== undefined && input.comment !== null && input.comment !== '') {
    if (typeof input.comment !== 'string') {
      errors.comment = 'Передайте текст або null.';
    } else {
      comment = input.comment.trim().replace(/\s+/gu, ' ');
      if (!comment || comment.length > 500) {
        errors.comment = 'Коментар не може містити більше 500 символів.';
      }
    }
  }
  if (Object.keys(errors).length) validationError(errors);
  return { version, comment };
}

export function validateCopyFound(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readReason(input.reason, 'reason', errors);
  if (Object.keys(errors).length) validationError(errors);
  return { version, reason };
}

export function validateLoanCorrection(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  if (!LOAN_STATUSES.has(input.status)) {
    errors.status = 'Допустимі значення: issued, lost, returned або compensated.';
  }
  const comment = readReason(input.comment, 'comment', errors);
  if (input.confirmCorrection !== true) {
    errors.confirmCorrection = 'Підтвердьте виправлення помилкової операції.';
  }

  let condition = null;
  let defectDescription = null;
  if (input.status === 'returned') {
    if (!CONDITIONS.has(input.condition)) {
      errors.condition = 'Для повернення вкажіть good, worn або damaged.';
    } else {
      condition = input.condition;
    }
    const description =
      typeof input.defectDescription === 'string'
        ? input.defectDescription.trim().replace(/\s+/gu, ' ')
        : '';
    if (condition === 'worn' || condition === 'damaged') {
      if (!description) {
        errors.defectDescription = 'Опишіть дефект зношеного або пошкодженого примірника.';
      } else {
        defectDescription = description;
      }
    } else if (
      input.defectDescription !== undefined &&
      input.defectDescription !== null &&
      input.defectDescription !== ''
    ) {
      errors.defectDescription = 'Для стану good опис дефекту не вказується.';
    }
  } else if (input.condition !== undefined || input.defectDescription !== undefined) {
    errors.condition = 'Фізичний стан передається лише при виправленні статусу на returned.';
  }

  if (Object.keys(errors).length) validationError(errors);
  return {
    version,
    status: input.status,
    comment,
    condition,
    defectDescription,
  };
}

export function validateErroneousReturn(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const comment = readReason(input.comment, 'comment', errors);
  if (input.confirmCorrection !== true) {
    errors.confirmCorrection = 'Підтвердьте фіксацію помилкового повернення.';
  }
  if (Object.keys(errors).length) validationError(errors);
  return { version, comment };
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
