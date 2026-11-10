import { AppError } from '../../http/app-error.js';

function cleanText(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані операції.', {
      fields: { body: 'Передайте JSON-об’єкт.' },
    });
  }
}

function readVersion(value, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors.version = 'Передайте поточну додатну версію видання.';
    return undefined;
  }
  return normalized;
}

function readOptionalReason(value, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    errors.reason = 'Передайте текст причини або null.';
    return undefined;
  }
  const reason = cleanText(value);
  if (!reason || reason.length > 500) {
    errors.reason = 'Причина має містити від 1 до 500 символів.';
    return undefined;
  }
  return reason;
}

function validateLifecycleAction(input, confirmationField, confirmationMessage, { reason = false } = {}) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  if (input[confirmationField] !== true) {
    errors[confirmationField] = confirmationMessage;
  }
  const result = { version };
  if (reason) result.reason = readOptionalReason(input.reason, errors);
  if (Object.keys(errors).length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте дані операції.', { fields: errors });
  }
  return result;
}

export function normalizeComparableText(value) {
  return cleanText(value).toLocaleLowerCase('uk-UA');
}

export function normalizeIsbn(value) {
  return value.replace(/[-\s]/gu, '').toUpperCase();
}

function isValidIsbn10(value) {
  if (!/^[0-9]{9}[0-9X]$/.test(value)) return false;
  const sum = [...value].reduce((total, character, index) => {
    const digit = character === 'X' ? 10 : Number(character);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isValidIsbn13(value) {
  if (!/^[0-9]{13}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(value[12]);
}

function currentYearInKyiv(now) {
  return Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric' }).format(now),
  );
}

function readAuthors(value, errors) {
  if (!Array.isArray(value)) {
    errors.authors = 'Передайте авторів масивом рядків.';
    return undefined;
  }

  const authors = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || cleanText(item) === '') {
      errors.authors = 'Кожен автор має бути непорожнім рядком.';
      return undefined;
    }
    const name = cleanText(item);
    const normalized = normalizeComparableText(name);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      authors.push(name);
    }
  }

  if (authors.length === 0) {
    errors.authors = 'Вкажіть щонайменше одного автора.';
  }
  return authors;
}

function validateFields(input, { partial, now }) {
  const errors = {};
  const result = {};

  for (const field of ['title', 'publisher']) {
    if (!partial || Object.hasOwn(input, field)) {
      if (typeof input[field] !== 'string' || cleanText(input[field]) === '') {
        errors[field] = 'Поле є обов’язковим і не може бути порожнім.';
      } else {
        result[field] = cleanText(input[field]);
      }
    }
  }

  if (!partial || Object.hasOwn(input, 'authors')) {
    result.authors = readAuthors(input.authors, errors);
  }

  if (!partial || Object.hasOwn(input, 'publicationYear')) {
    const year = input.publicationYear ?? null;
    const maximumYear = currentYearInKyiv(now);
    if (year !== null && (!Number.isInteger(year) || year < 1 || year > maximumYear)) {
      errors.publicationYear = `Вкажіть цілий рік від 1 до ${maximumYear} або null.`;
    } else {
      result.publicationYear = year;
    }
  }

  if (!partial || Object.hasOwn(input, 'isbn')) {
    if (input.isbn === null || input.isbn === undefined || input.isbn === '') {
      result.isbn = null;
      result.isbnNormalized = null;
    } else if (typeof input.isbn !== 'string') {
      errors.isbn = 'ISBN має бути рядком або null.';
    } else {
      const isbn = cleanText(input.isbn);
      const normalized = normalizeIsbn(isbn);
      if (!isValidIsbn10(normalized) && !isValidIsbn13(normalized)) {
        errors.isbn = 'Вкажіть коректний ISBN-10 або ISBN-13.';
      } else {
        result.isbn = isbn;
        result.isbnNormalized = normalized;
      }
    }
  }

  if (!partial || Object.hasOwn(input, 'isTextbook')) {
    const value = input.isTextbook ?? false;
    if (typeof value !== 'boolean') {
      errors.isTextbook = 'Ознака підручника має бути true або false.';
    } else {
      result.isTextbook = value;
    }
  }

  if (Object.hasOwn(input, 'confirmDuplicate') && typeof input.confirmDuplicate !== 'boolean') {
    errors.confirmDuplicate = 'Підтвердження має бути true або false.';
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте заповнення книги.', { fields: errors });
  }

  return {
    values: result,
    confirmDuplicate: input.confirmDuplicate === true,
  };
}

export function validateBookCreate(input, now = new Date()) {
  return validateFields(input, { partial: false, now });
}

export function validateBookUpdate(input, now = new Date()) {
  const result = validateFields(input, { partial: true, now });
  if (Object.keys(result.values).length === 0) {
    throw new AppError(400, 'EMPTY_UPDATE', 'Передайте хоча б одне поле книги для зміни.');
  }
  return result;
}

export function validateBookArchive(input) {
  return validateLifecycleAction(
    input,
    'confirmArchive',
    'Підтвердьте архівацію видання та його примірників.',
    { reason: true },
  );
}

export function validateBookRestore(input) {
  return validateLifecycleAction(input, 'confirmRestore', 'Підтвердьте відновлення видання.');
}

export function validateBookDelete(input) {
  return validateLifecycleAction(
    input,
    'confirmDelete',
    'Підтвердьте незворотне видалення невикористаного видання.',
  );
}

export function validateBookIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}
