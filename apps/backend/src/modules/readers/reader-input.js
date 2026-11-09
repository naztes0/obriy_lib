import { AppError } from '../../http/app-error.js';

const TICKET_PATTERN = /^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}$/u;
const PHONE_PATTERN = /^\+380[0-9]{9}$/;
const CATEGORIES = new Set(['student', 'employee']);
const TICKET_TYPES = new Set(['existing', 'electronic']);

function cleanText(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function throwValidation(fields) {
  throw new AppError(400, 'VALIDATION_ERROR', 'Перевірте заповнення картки читача.', {
    fields,
  });
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throwValidation({ body: 'Передайте JSON-об’єкт.' });
  }
}

function readRequiredText(value, field, maximum, errors) {
  if (typeof value !== 'string') {
    errors[field] = 'Поле є обов’язковим.';
    return undefined;
  }
  const result = cleanText(value);
  if (!result || result.length > maximum) {
    errors[field] = `Вкажіть від 1 до ${maximum} символів.`;
    return undefined;
  }
  return result;
}

function readOptionalText(value, field, maximum, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    errors[field] = 'Передайте рядок або null.';
    return undefined;
  }
  const result = cleanText(value);
  if (!result) return null;
  if (result.length > maximum) {
    errors[field] = `Значення не може містити більше ${maximum} символів.`;
    return undefined;
  }
  return result;
}

function readId(value, field, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors[field] = 'Виберіть коректний запис.';
    return undefined;
  }
  return normalized;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateEmploymentEnd(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  let employmentEndedOn = null;
  if (input.employmentEndedOn !== null) {
    if (!isValidDate(input.employmentEndedOn)) {
      errors.employmentEndedOn = 'Вкажіть коректну дату у форматі YYYY-MM-DD або null.';
    } else {
      employmentEndedOn = input.employmentEndedOn;
    }
  }
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, employmentEndedOn };
}

function validateValues(values, { creating }) {
  const errors = {};
  const result = {};

  result.fullName = readRequiredText(values.fullName, 'fullName', 200, errors);

  if (!CATEGORIES.has(values.category)) {
    errors.category = 'Допустимі значення: student або employee.';
  } else {
    result.category = values.category;
  }

  if (typeof values.phone !== 'string' || !PHONE_PATTERN.test(values.phone)) {
    errors.phone = 'Вкажіть номер у форматі +380XXXXXXXXX без пробілів.';
  } else {
    result.phone = values.phone;
  }
  result.address = readOptionalText(values.address, 'address', 500, errors);

  if (!TICKET_TYPES.has(values.ticketType)) {
    errors.ticketType = 'Допустимі значення: existing або electronic.';
  } else {
    result.ticketType = values.ticketType;
  }

  if (values.category === 'student') {
    result.classId = readId(values.classId, 'classId', errors);
    if (!isValidDate(values.ticketExpiresOn)) {
      errors.ticketExpiresOn = 'Вкажіть коректну дату у форматі YYYY-MM-DD.';
    } else {
      result.ticketExpiresOn = values.ticketExpiresOn;
    }
  } else if (values.category === 'employee') {
    if (values.classId !== null && values.classId !== undefined) {
      errors.classId = 'Для працівника клас не вказується.';
    }
    if (values.ticketExpiresOn !== null && values.ticketExpiresOn !== undefined) {
      errors.ticketExpiresOn = 'Для працівника строк квитка не вказується.';
    }
    result.classId = null;
    result.ticketExpiresOn = null;
  }

  if (values.ticketType === 'electronic') {
    if (values.category !== 'student') {
      errors.ticketType = 'Електронний квиток можна сформувати лише для учня.';
    }
    if (creating && values.ticketNumber !== undefined && values.ticketNumber !== null && values.ticketNumber !== '') {
      errors.ticketNumber = 'Номер електронного квитка генерується автоматично.';
    } else if (!creating) {
      const ticketNumber = typeof values.ticketNumber === 'string' ? values.ticketNumber.trim() : '';
      if (!TICKET_PATTERN.test(ticketNumber)) {
        errors.ticketNumber =
          'Вкажіть 1–32 українські або латинські літери, цифри, дефіс чи косу риску.';
      } else {
        result.ticketNumber = ticketNumber;
      }
    }
  } else if (values.ticketType === 'existing') {
    const ticketNumber = typeof values.ticketNumber === 'string' ? values.ticketNumber.trim() : '';
    if (!TICKET_PATTERN.test(ticketNumber)) {
      errors.ticketNumber =
        'Вкажіть 1–32 українські або латинські літери, цифри, дефіс чи косу риску.';
    } else {
      result.ticketNumber = ticketNumber;
    }
  }

  if (Object.keys(errors).length) throwValidation(errors);
  return result;
}

export function normalizeComparableName(value) {
  return cleanText(value).toLocaleLowerCase('uk-UA');
}

export function validateReaderCreate(input) {
  requireObject(input);
  return {
    values: validateValues(input, { creating: true }),
    confirmNamesake: input.confirmNamesake === true,
  };
}

export function validateReaderUpdate(input, existing) {
  requireObject(input);
  const editableFields = [
    'fullName',
    'category',
    'classId',
    'phone',
    'address',
    'ticketNumber',
    'ticketExpiresOn',
  ];
  const supplied = editableFields.filter((field) => Object.hasOwn(input, field));
  if (!supplied.length) {
    throw new AppError(400, 'EMPTY_UPDATE', 'Передайте хоча б одне поле читача для зміни.');
  }
  if (Object.hasOwn(input, 'ticketType') || Object.hasOwn(input, 'ticketIssuedOn')) {
    throwValidation({ ticketType: 'Тип і дату формування квитка після створення не змінюють.' });
  }

  const merged = {
    fullName: existing.fullName,
    category: existing.category,
    classId: existing.schoolClass?.id ?? null,
    phone: existing.phone,
    address: existing.address,
    ticketType: existing.ticketType,
    ticketNumber: existing.ticketNumber,
    ticketExpiresOn: existing.ticketExpiresOn,
  };
  for (const field of supplied) merged[field] = input[field];

  return {
    values: validateValues(merged, { creating: false }),
    supplied,
    confirmNamesake: input.confirmNamesake === true,
    confirmTicketNumberChange: input.confirmTicketNumberChange === true,
    reason: typeof input.reason === 'string' ? cleanText(input.reason) : '',
  };
}

function readVersion(value, errors) {
  const normalized = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    errors.version = 'Передайте поточну додатну версію картки.';
    return undefined;
  }
  return normalized;
}

export function validateReaderArchive(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  const reason = readRequiredText(input.reason, 'reason', 500, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version, reason };
}

export function validateReaderRestore(input) {
  requireObject(input);
  const errors = {};
  const version = readVersion(input.version, errors);
  if (Object.keys(errors).length) throwValidation(errors);
  return { version };
}

export function validateReaderIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Передайте заголовок Idempotency-Key довжиною від 1 до 128 символів.',
    );
  }
  return value.trim();
}
