import { AppError } from '../../http/app-error.js';

const REASON_CODES = new Set(['overdue', 'unresolved_loss']);
const DECISIONS = new Set(['approved', 'rejected']);

function cleanText(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function throwValidation(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані блокування.', { fields });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throwValidation({ body: 'Передайте JSON-об’єкт.' });
  }
}

function readId(value, field, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors[field] = 'Передайте коректний ідентифікатор.';
    return undefined;
  }
  return normalized;
}

function readVersion(value, errors) {
  const version = readId(value, 'version', errors);
  if (errors.version) errors.version = 'Передайте поточну додатну версію запису.';
  return version;
}

function readOptionalComment(value, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    errors.comment = 'Передайте текст або null.';
    return undefined;
  }
  const comment = cleanText(value);
  if (!comment || comment.length > 500) {
    errors.comment = 'Коментар не може містити більше 500 символів.';
    return undefined;
  }
  return comment;
}

function readReason(value, errors) {
  if (typeof value !== 'string') {
    errors.reason = 'Вкажіть причину.';
    return undefined;
  }
  const reason = cleanText(value);
  if (!reason || reason.length > 500) {
    errors.reason = 'Вкажіть причину довжиною від 1 до 500 символів.';
    return undefined;
  }
  return reason;
}

export function validateBlockConfirmation(input) {
  requireObject(input);
  const errors = {};
  const sourceLoanId = readId(input.sourceLoanId, 'sourceLoanId', errors);
  if (!REASON_CODES.has(input.reasonCode)) {
    errors.reasonCode = 'Допустимі значення: overdue або unresolved_loss.';
  }
  if (Object.keys(errors).length) throwValidation(errors);
  return { sourceLoanId, reasonCode: input.reasonCode };
}

export function validateUnblockRequest(input) {
  requireObject(input);
  const errors = {};
  const comment = readOptionalComment(input.comment, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { comment };
}

export function validateUnblock(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const comment = readOptionalComment(input.comment, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, comment };
}

export function validateUnblockDecision(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  if (!DECISIONS.has(input.decision)) {
    errors.decision = 'Допустимі значення: approved або rejected.';
  }
  const comment = readOptionalComment(input.comment, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, decision: input.decision, comment };
}

export function validateBlockAnnulment(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readReason(input.reason, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, reason };
}

export function validateRestrictionIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}
