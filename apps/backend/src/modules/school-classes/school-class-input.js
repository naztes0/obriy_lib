import { AppError } from '../../http/app-error.js';

function validationError(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте заповнення класу.', { fields });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    validationError({ body: 'Передайте JSON-об’єкт.' });
  }
}

export function validateClassName(input) {
  requireObject(input);
  if (typeof input.name !== 'string') {
    validationError({ name: 'Вкажіть назву класу.' });
  }

  const name = input.name.trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 64) {
    validationError({ name: 'Назва має містити від 1 до 64 символів.' });
  }
  return { name };
}

export function validateClassActivity(input) {
  requireObject(input);
  if (typeof input.isActive !== 'boolean') {
    validationError({ isActive: 'Передайте true або false.' });
  }
  return { isActive: input.isActive };
}
