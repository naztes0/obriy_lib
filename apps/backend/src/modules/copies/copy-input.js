import { AppError } from '../../http/app-error.js';

const INVENTORY_NUMBER_PATTERN = /^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}$/u;
const CONDITIONS = new Set(['good', 'worn', 'damaged']);

function cleanText(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function throwValidation(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте заповнення примірника.', { fields });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throwValidation({ body: 'Передайте JSON-об’єкт.' });
  }
}

function readCondition(input, errors) {
  if (typeof input.condition !== 'string' || !CONDITIONS.has(input.condition)) {
    errors.condition = 'Допустимі значення: good, worn або damaged.';
    return undefined;
  }
  return input.condition;
}

function readDefectDescription(input, condition, errors) {
  const raw = input.defectDescription;
  const description = typeof raw === 'string' ? cleanText(raw) : '';

  if (condition === 'worn' || condition === 'damaged') {
    if (!description) {
      errors.defectDescription = 'Для зношеного або пошкодженого примірника опишіть дефект.';
    }
    return description || undefined;
  }

  if (raw !== undefined && raw !== null && raw !== '') {
    errors.defectDescription = 'Для стану good опис дефекту не вказується.';
  }
  return null;
}

function readReason(value, errors) {
  if (typeof value !== 'string') {
    errors.reason = 'Вкажіть причину зміни.';
    return undefined;
  }
  const result = cleanText(value);
  if (!result || result.length > 500) {
    errors.reason = 'Вкажіть причину довжиною від 1 до 500 символів.';
    return undefined;
  }
  return result;
}

function readVersion(value, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors.version = 'Передайте поточну додатну версію примірника.';
    return undefined;
  }
  return normalized;
}

function readConfirmation(input, field, message, errors) {
  if (input[field] !== true) errors[field] = message;
}

function readOptionalReason(value, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    errors.reason = 'Передайте текст причини або null.';
    return undefined;
  }
  const result = cleanText(value);
  if (!result || result.length > 500) {
    errors.reason = 'Причина має містити від 1 до 500 символів.';
    return undefined;
  }
  return result;
}

export function validateCopyCreate(input) {
  requireObject(input);
  const errors = {};
  const inventoryNumber =
    typeof input.inventoryNumber === 'string' ? cleanText(input.inventoryNumber) : '';
  if (!INVENTORY_NUMBER_PATTERN.test(inventoryNumber)) {
    errors.inventoryNumber =
      'Вкажіть 1–32 українські або латинські літери, цифри, дефіс чи косу риску.';
  }

  const condition = readCondition(input, errors);
  const defectDescription = readDefectDescription(input, condition, errors);
  if (Object.keys(errors).length) throwValidation(errors);

  return { inventoryNumber, condition, defectDescription };
}

export function validateConditionChange(input) {
  requireObject(input);
  const errors = {};
  const condition = readCondition(input, errors);
  const defectDescription = readDefectDescription(input, condition, errors);
  const reason = readReason(input.reason, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { condition, defectDescription, reason };
}

export function validateTemporaryUnavailability(input) {
  requireObject(input);
  const errors = {};
  if (typeof input.isTemporarilyUnavailable !== 'boolean') {
    errors.isTemporarilyUnavailable = 'Передайте true або false.';
  }
  const reason = readReason(input.reason, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { isTemporarilyUnavailable: input.isTemporarilyUnavailable, reason };
}

export function validateCopyLoss(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readReason(input.reason, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, reason };
}

export function validateCopyIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}

export function validateCopyArchive(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readOptionalReason(input.reason, errors);
  readConfirmation(
    input,
    'confirmArchive',
    'Підтвердьте архівацію примірника.',
    errors,
  );
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, reason };
}

export function validateCopyRestore(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  readConfirmation(
    input,
    'confirmRestore',
    'Підтвердьте відновлення примірника.',
    errors,
  );
  if (Object.keys(errors).length) throwValidation(errors);
  return { version };
}

export function validateCopyDelete(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  readConfirmation(
    input,
    'confirmDelete',
    'Підтвердьте незворотне видалення невикористаного примірника.',
    errors,
  );
  if (Object.keys(errors).length) throwValidation(errors);
  return { version };
}

export function validateInventoryNumberCorrection(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const inventoryNumber =
    typeof input.inventoryNumber === 'string' ? cleanText(input.inventoryNumber) : '';
  if (!INVENTORY_NUMBER_PATTERN.test(inventoryNumber)) {
    errors.inventoryNumber =
      'Вкажіть 1–32 українські або латинські літери, цифри, дефіс чи косу риску.';
  }
  const reason = readReason(input.reason, errors);
  readConfirmation(
    input,
    'confirmNumberChange',
    'Підтвердьте, що новий інвентарний номер перевірено.',
    errors,
  );
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, inventoryNumber, reason };
}

export function validateCopyWriteOff(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readReason(input.reason, errors);
  readConfirmation(
    input,
    'confirmReportImpact',
    'Підтвердьте, що історія примірника зникне, а підсумки звітів зміняться.',
    errors,
  );
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, reason };
}
