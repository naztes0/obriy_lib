import { AppError } from '../../http/app-error.js';

function validationError(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані працівника.', { fields });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    validationError({ body: 'Передайте JSON-об’єкт.' });
  }
}

function readDisplayName(value, errors) {
  if (typeof value !== 'string') {
    errors.displayName = 'Вкажіть ПІБ або відображуване ім’я.';
    return undefined;
  }
  const result = value.trim().replace(/\s+/gu, ' ');
  if (!result || result.length > 200) {
    errors.displayName = 'Ім’я має містити від 1 до 200 символів.';
    return undefined;
  }
  return result;
}

function readPassword(value, field, errors) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    errors[field] = 'Пароль має містити від 8 до 128 символів.';
    return undefined;
  }
  return value;
}

function readCurrentPassword(value, errors) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    errors.currentPassword = 'Вкажіть поточний пароль.';
    return undefined;
  }
  return value;
}

export function readStaffId(value) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError(400, 'INVALID_STAFF_ID', 'Некоректний ідентифікатор працівника.');
  }
  return value;
}

export function validateLibrarianCreate(input) {
  requireObject(input);
  const errors = {};
  const login = typeof input.login === 'string' ? input.login.trim() : '';
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(login)) {
    errors.login = 'Логін має містити 3–64 латинські літери, цифри або символи ._-.';
  }
  const displayName = readDisplayName(input.displayName, errors);
  const password = readPassword(input.password, 'password', errors);
  if (Object.keys(errors).length) validationError(errors);
  return { login, displayName, password };
}

export function validateStaffActivity(input) {
  requireObject(input);
  if (typeof input.isActive !== 'boolean') {
    validationError({ isActive: 'Передайте true або false.' });
  }
  return { isActive: input.isActive };
}

export function validateLibrarianPassword(input) {
  requireObject(input);
  const errors = {};
  const newPassword = readPassword(input.newPassword, 'newPassword', errors);
  if (Object.keys(errors).length) validationError(errors);
  return { newPassword };
}

export function validateManagerProfile(input) {
  requireObject(input);
  const errors = {};
  const displayName = readDisplayName(input.displayName, errors);
  if (Object.keys(errors).length) validationError(errors);
  return { displayName };
}

export function validateManagerPassword(input) {
  requireObject(input);
  const errors = {};
  const currentPassword = readCurrentPassword(input.currentPassword, errors);
  const newPassword = readPassword(input.newPassword, 'newPassword', errors);
  if (Object.keys(errors).length) validationError(errors);
  return { currentPassword, newPassword };
}
