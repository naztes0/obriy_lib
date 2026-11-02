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
  if (typeof value !== 'string' || cleanText(value) === '') {
    errors.reason = 'Вкажіть причину зміни.';
    return undefined;
  }
  return cleanText(value);
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
