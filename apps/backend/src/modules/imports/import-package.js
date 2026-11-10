import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

const FILES = [
  {
    key: 'books',
    name: 'books.csv',
    required: true,
    headers: [
      'source_id', 'title', 'authors', 'publisher', 'publication_year', 'isbn',
      'is_textbook', 'archived_at',
    ],
  },
  {
    key: 'copies',
    name: 'copies.csv',
    required: true,
    headers: [
      'source_id', 'book_source_id', 'inventory_number', 'condition', 'defect_description',
      'is_temporarily_unavailable', 'is_lost', 'archived_at',
    ],
  },
  {
    key: 'readers',
    name: 'readers.csv',
    required: true,
    headers: [
      'source_id', 'full_name', 'category', 'class_name', 'phone', 'address',
      'ticket_number', 'ticket_type', 'ticket_issued_on', 'ticket_expires_on',
      'employment_ended_on', 'archived_at', 'archive_reason',
    ],
  },
  {
    key: 'loans',
    name: 'loans.csv',
    required: true,
    headers: [
      'source_id', 'reader_source_id', 'copy_source_id', 'issued_at', 'initial_due_date',
      'current_due_date', 'status', 'returned_at', 'compensated_at', 'performed_by',
      'issue_condition', 'issue_defect_snapshot', 'return_condition',
      'return_defect_snapshot', 'reader_category_snapshot', 'class_name_snapshot',
    ],
  },
  {
    key: 'loanEvents',
    name: 'loan_events.csv',
    required: false,
    headers: [
      'source_id', 'loan_source_id', 'from_status', 'to_status', 'occurred_at',
      'performed_by', 'comment',
    ],
  },
  {
    key: 'loanExtensions',
    name: 'loan_extensions.csv',
    required: false,
    headers: [
      'source_id', 'loan_source_id', 'old_due_date', 'new_due_date', 'reason',
      'occurred_at', 'performed_by',
    ],
  },
  {
    key: 'copyEvents',
    name: 'copy_events.csv',
    required: false,
    headers: [
      'source_id', 'copy_source_id', 'kind', 'old_value', 'new_value', 'reason',
      'occurred_at', 'performed_by',
    ],
  },
  {
    key: 'readerBlocks',
    name: 'reader_blocks.csv',
    required: false,
    headers: [
      'source_id', 'reader_source_id', 'loan_source_id', 'reason_code', 'confirmed_at',
      'confirmed_by', 'minimum_until', 'is_indefinite', 'resolved_at', 'resolved_by',
      'resolution_comment', 'annulled_at', 'annulled_by', 'annul_reason',
    ],
  },
  {
    key: 'unblockRequests',
    name: 'unblock_requests.csv',
    required: false,
    headers: [
      'source_id', 'block_source_id', 'requested_at', 'requested_by', 'request_comment',
      'decision', 'decided_at', 'decided_by', 'decision_comment',
    ],
  },
];

const CONDITIONS = new Set(['good', 'worn', 'damaged', 'unrecorded']);
const ISSUE_CONDITIONS = new Set(['good', 'worn', 'unrecorded']);
const LOAN_STATUSES = new Set(['issued', 'lost', 'returned', 'compensated']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const NUMBER_PATTERN = /^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}$/u;

export class ImportPackageError extends Error {
  constructor(errors) {
    super('CSV package validation failed');
    this.name = 'ImportPackageError';
    this.errors = errors;
  }
}

function issue(file, row, field, message) {
  return { file, row, field, message };
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value) {
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(new Date(value).valueOf());
}

function parseRequired(record, field, errors) {
  const value = record[field]?.trim();
  if (!value) {
    errors.push(issue(record._file, record._row, field, 'Обов’язкове значення відсутнє.'));
    return null;
  }
  return value;
}

function parseOptional(record, field) {
  const value = record[field]?.trim();
  return value ? value : null;
}

function parseBoolean(record, field, errors) {
  const value = parseRequired(record, field, errors);
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  errors.push(issue(record._file, record._row, field, 'Допустимі значення: true або false.'));
  return null;
}

function parseDate(record, field, errors, { required = false } = {}) {
  const value = required ? parseRequired(record, field, errors) : parseOptional(record, field);
  if (value === null) return null;
  if (!isValidDate(value)) {
    errors.push(issue(record._file, record._row, field, 'Вкажіть дату у форматі YYYY-MM-DD.'));
    return null;
  }
  return value;
}

function parseTimestamp(record, field, errors, { required = false } = {}) {
  const value = required ? parseRequired(record, field, errors) : parseOptional(record, field);
  if (value === null) return null;
  if (!isValidTimestamp(value)) {
    errors.push(
      issue(
        record._file,
        record._row,
        field,
        'Вкажіть дату й час ISO 8601 із часовим поясом.',
      ),
    );
    return null;
  }
  return value;
}

function parseEnum(record, field, values, errors, { required = true } = {}) {
  const value = required ? parseRequired(record, field, errors) : parseOptional(record, field);
  if (value === null) return null;
  if (!values.has(value)) {
    errors.push(
      issue(record._file, record._row, field, `Допустимі значення: ${[...values].join(', ')}.`),
    );
    return null;
  }
  return value;
}

function isValidIsbn(value) {
  const normalized = value.replace(/[-\s]/gu, '').toUpperCase();
  if (/^[0-9]{9}[0-9X]$/.test(normalized)) {
    const sum = [...normalized].reduce((total, character, index) => {
      const digit = character === 'X' ? 10 : Number(character);
      return total + digit * (10 - index);
    }, 0);
    return sum % 11 === 0;
  }
  if (!/^[0-9]{13}$/.test(normalized)) return false;
  const sum = [...normalized.slice(0, 12)].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(normalized[12]);
}

function normalizeCommon(records, errors) {
  const seen = new Map();
  for (const record of records) {
    record.source_id = parseRequired(record, 'source_id', errors);
    if (record.source_id && record.source_id.length > 128) {
      errors.push(issue(record._file, record._row, 'source_id', 'Максимум 128 символів.'));
    }
    if (record.source_id) {
      const duplicate = seen.get(record.source_id);
      if (duplicate) {
        errors.push(
          issue(
            record._file,
            record._row,
            'source_id',
            `Значення вже використано в рядку ${duplicate}.`,
          ),
        );
      } else {
        seen.set(record.source_id, record._row);
      }
    }
  }
}

function normalizeBooks(records, errors, currentYear) {
  normalizeCommon(records, errors);
  const seenIsbn = new Map();
  for (const record of records) {
    record.title = parseRequired(record, 'title', errors);
    record.publisher = parseRequired(record, 'publisher', errors);
    const authors = parseRequired(record, 'authors', errors);
    if (authors) {
      const uniqueAuthors = new Map();
      for (const name of authors.split('|').map((value) => value.trim()).filter(Boolean)) {
        const normalized = name.replace(/\s+/gu, ' ').toLocaleLowerCase('uk-UA');
        if (!uniqueAuthors.has(normalized)) uniqueAuthors.set(normalized, name.replace(/\s+/gu, ' '));
      }
      record.authors = [...uniqueAuthors.values()];
    } else {
      record.authors = [];
    }
    if (authors && record.authors.length === 0) {
      errors.push(issue(record._file, record._row, 'authors', 'Вкажіть хоча б одного автора.'));
    }
    const year = parseOptional(record, 'publication_year');
    record.publication_year = year === null ? null : Number(year);
    if (
      year !== null &&
      (!/^\d+$/.test(year) || record.publication_year < 1 || record.publication_year > currentYear)
    ) {
      errors.push(
        issue(record._file, record._row, 'publication_year', `Вкажіть рік від 1 до ${currentYear}.`),
      );
    }
    record.isbn = parseOptional(record, 'isbn');
    if (record.isbn && !isValidIsbn(record.isbn)) {
      errors.push(issue(record._file, record._row, 'isbn', 'Вкажіть коректний ISBN-10 або ISBN-13.'));
    }
    if (record.isbn) {
      const normalized = record.isbn.replace(/[-\s]/gu, '').toUpperCase();
      if (seenIsbn.has(normalized)) {
        errors.push(issue(record._file, record._row, 'isbn', 'ISBN дублюється в пакеті.'));
      }
      seenIsbn.set(normalized, record._row);
      record.isbn_normalized = normalized;
    } else {
      record.isbn_normalized = null;
    }
    record.is_textbook = parseBoolean(record, 'is_textbook', errors);
    record.archived_at = parseTimestamp(record, 'archived_at', errors);
  }
}

function normalizeCopies(records, errors) {
  normalizeCommon(records, errors);
  const seenInventory = new Set();
  for (const record of records) {
    record.book_source_id = parseRequired(record, 'book_source_id', errors);
    record.inventory_number = parseRequired(record, 'inventory_number', errors);
    if (record.inventory_number && !NUMBER_PATTERN.test(record.inventory_number)) {
      errors.push(
        issue(record._file, record._row, 'inventory_number', 'Некоректний інвентарний номер.'),
      );
    }
    if (record.inventory_number) {
      const normalized = record.inventory_number.toLocaleUpperCase('uk-UA');
      if (seenInventory.has(normalized)) {
        errors.push(
          issue(record._file, record._row, 'inventory_number', 'Номер дублюється в пакеті.'),
        );
      }
      seenInventory.add(normalized);
      record.inventory_number_normalized = normalized;
    }
    record.condition = parseEnum(record, 'condition', CONDITIONS, errors);
    record.defect_description = parseOptional(record, 'defect_description');
    if (
      ['worn', 'damaged'].includes(record.condition) &&
      record.defect_description === null
    ) {
      errors.push(
        issue(record._file, record._row, 'defect_description', 'Для цього стану потрібен опис.'),
      );
    }
    record.is_temporarily_unavailable = parseBoolean(
      record,
      'is_temporarily_unavailable',
      errors,
    );
    record.is_lost = parseBoolean(record, 'is_lost', errors);
    record.archived_at = parseTimestamp(record, 'archived_at', errors);
  }
}

function normalizeReaders(records, errors) {
  normalizeCommon(records, errors);
  const seenTickets = new Set();
  for (const record of records) {
    record.full_name = parseRequired(record, 'full_name', errors);
    record.category = parseEnum(record, 'category', new Set(['student', 'employee']), errors);
    record.class_name = parseOptional(record, 'class_name');
    record.phone = parseRequired(record, 'phone', errors);
    if (record.phone && !/^\+380[0-9]{9}$/.test(record.phone)) {
      errors.push(issue(record._file, record._row, 'phone', 'Вкажіть номер у форматі +380XXXXXXXXX.'));
    }
    record.address = parseOptional(record, 'address');
    record.ticket_number = parseRequired(record, 'ticket_number', errors);
    if (record.ticket_number && !NUMBER_PATTERN.test(record.ticket_number)) {
      errors.push(issue(record._file, record._row, 'ticket_number', 'Некоректний номер квитка.'));
    }
    if (record.ticket_number) {
      const normalized = record.ticket_number.toLocaleUpperCase('uk-UA');
      if (seenTickets.has(normalized)) {
        errors.push(issue(record._file, record._row, 'ticket_number', 'Номер дублюється в пакеті.'));
      }
      seenTickets.add(normalized);
      record.ticket_number_normalized = normalized;
    }
    record.ticket_type = parseEnum(
      record,
      'ticket_type',
      new Set(['existing', 'electronic']),
      errors,
    );
    record.ticket_issued_on = parseDate(record, 'ticket_issued_on', errors);
    record.ticket_expires_on = parseDate(record, 'ticket_expires_on', errors);
    record.employment_ended_on = parseDate(record, 'employment_ended_on', errors);
    record.archived_at = parseTimestamp(record, 'archived_at', errors);
    record.archive_reason = parseOptional(record, 'archive_reason');

    if (record.category === 'student') {
      if (!record.class_name) {
        errors.push(issue(record._file, record._row, 'class_name', 'Клас учня обов’язковий.'));
      }
      if (!record.ticket_expires_on) {
        errors.push(
          issue(record._file, record._row, 'ticket_expires_on', 'Строк квитка учня обов’язковий.'),
        );
      }
      if (record.employment_ended_on) {
        errors.push(
          issue(record._file, record._row, 'employment_ended_on', 'Поле доступне лише працівнику.'),
        );
      }
    }
    if (record.category === 'employee') {
      if (record.class_name || record.ticket_expires_on || record.ticket_issued_on) {
        errors.push(
          issue(
            record._file,
            record._row,
            'category',
            'Працівник не має класу, строку або дати формування електронного квитка.',
          ),
        );
      }
    }
    if (record.ticket_type === 'electronic') {
      if (record.category !== 'student' || !record.ticket_issued_on) {
        errors.push(
          issue(
            record._file,
            record._row,
            'ticket_type',
            'Електронний квиток потребує учня і дати формування.',
          ),
        );
      }
    } else if (record.ticket_issued_on) {
      errors.push(
        issue(record._file, record._row, 'ticket_issued_on', 'Для фізичного квитка поле порожнє.'),
      );
    }
    if (record.archived_at && !record.archive_reason) {
      errors.push(
        issue(record._file, record._row, 'archive_reason', 'Для архівної картки потрібна причина.'),
      );
    }
  }
}

function normalizeLoans(records, errors) {
  normalizeCommon(records, errors);
  const openCopies = new Set();
  for (const record of records) {
    record.reader_source_id = parseRequired(record, 'reader_source_id', errors);
    record.copy_source_id = parseRequired(record, 'copy_source_id', errors);
    record.issued_at = parseTimestamp(record, 'issued_at', errors, { required: true });
    record.initial_due_date = parseDate(record, 'initial_due_date', errors, { required: true });
    record.current_due_date = parseDate(record, 'current_due_date', errors, { required: true });
    record.status = parseEnum(record, 'status', LOAN_STATUSES, errors);
    record.returned_at = parseTimestamp(record, 'returned_at', errors);
    record.compensated_at = parseTimestamp(record, 'compensated_at', errors);
    record.performed_by = parseRequired(record, 'performed_by', errors);
    record.issue_condition = parseEnum(record, 'issue_condition', ISSUE_CONDITIONS, errors);
    record.issue_defect_snapshot = parseOptional(record, 'issue_defect_snapshot');
    record.return_condition = parseEnum(record, 'return_condition', CONDITIONS, errors, {
      required: false,
    });
    record.return_defect_snapshot = parseOptional(record, 'return_defect_snapshot');
    record.reader_category_snapshot = parseEnum(
      record,
      'reader_category_snapshot',
      new Set(['student', 'employee']),
      errors,
    );
    record.class_name_snapshot = parseOptional(record, 'class_name_snapshot');

    if (
      record.initial_due_date &&
      record.current_due_date &&
      record.initial_due_date > record.current_due_date
    ) {
      errors.push(
        issue(record._file, record._row, 'current_due_date', 'Дата не може бути раніше початкової.'),
      );
    }
    const issuedDate = record.issued_at?.slice(0, 10);
    if (issuedDate && record.initial_due_date && record.initial_due_date < issuedDate) {
      errors.push(
        issue(record._file, record._row, 'initial_due_date', 'Строк не може бути раніше видачі.'),
      );
    }
    const hasReturned = record.returned_at !== null;
    const hasCompensated = record.compensated_at !== null;
    if (
      (record.status === 'returned' && (!hasReturned || hasCompensated)) ||
      (record.status === 'compensated' && (hasReturned || !hasCompensated)) ||
      (['issued', 'lost'].includes(record.status) && (hasReturned || hasCompensated))
    ) {
      errors.push(
        issue(record._file, record._row, 'status', 'Статус не узгоджений із датою завершення.'),
      );
    }
    if (record.issued_at && record.returned_at && new Date(record.returned_at) < new Date(record.issued_at)) {
      errors.push(issue(record._file, record._row, 'returned_at', 'Повернення не може бути раніше видачі.'));
    }
    if (
      record.issued_at &&
      record.compensated_at &&
      new Date(record.compensated_at) < new Date(record.issued_at)
    ) {
      errors.push(
        issue(record._file, record._row, 'compensated_at', 'Відшкодування не може бути раніше видачі.'),
      );
    }
    if (record.status === 'returned' && !record.return_condition) {
      errors.push(
        issue(record._file, record._row, 'return_condition', 'Для повернення потрібен стан.'),
      );
    }
    if (
      ['worn', 'damaged'].includes(record.return_condition) &&
      !record.return_defect_snapshot
    ) {
      errors.push(
        issue(record._file, record._row, 'return_defect_snapshot', 'Потрібен опис дефекту.'),
      );
    }
    if (
      record.reader_category_snapshot === 'student' &&
      !record.class_name_snapshot
    ) {
      errors.push(
        issue(record._file, record._row, 'class_name_snapshot', 'Для учня потрібен клас.'),
      );
    }
    if (
      record.reader_category_snapshot === 'employee' &&
      record.class_name_snapshot
    ) {
      errors.push(
        issue(record._file, record._row, 'class_name_snapshot', 'Для працівника клас порожній.'),
      );
    }
    if (['issued', 'lost'].includes(record.status) && record.copy_source_id) {
      if (openCopies.has(record.copy_source_id)) {
        errors.push(
          issue(record._file, record._row, 'copy_source_id', 'Примірник має дві незавершені видачі.'),
        );
      }
      openCopies.add(record.copy_source_id);
    }
  }
}

function normalizeLoanEvents(records, errors) {
  normalizeCommon(records, errors);
  for (const record of records) {
    record.loan_source_id = parseRequired(record, 'loan_source_id', errors);
    record.from_status = parseEnum(record, 'from_status', LOAN_STATUSES, errors, { required: false });
    record.to_status = parseEnum(record, 'to_status', LOAN_STATUSES, errors);
    record.occurred_at = parseTimestamp(record, 'occurred_at', errors, { required: true });
    record.performed_by = parseRequired(record, 'performed_by', errors);
    record.comment = parseOptional(record, 'comment');
    if (record.from_status && record.from_status === record.to_status) {
      errors.push(issue(record._file, record._row, 'to_status', 'Статус має змінитися.'));
    }
  }
}

function normalizeLoanExtensions(records, errors) {
  normalizeCommon(records, errors);
  const loans = new Set();
  for (const record of records) {
    record.loan_source_id = parseRequired(record, 'loan_source_id', errors);
    if (record.loan_source_id && loans.has(record.loan_source_id)) {
      errors.push(
        issue(record._file, record._row, 'loan_source_id', 'Видачу можна продовжити лише один раз.'),
      );
    }
    loans.add(record.loan_source_id);
    record.old_due_date = parseDate(record, 'old_due_date', errors, { required: true });
    record.new_due_date = parseDate(record, 'new_due_date', errors, { required: true });
    record.reason = parseRequired(record, 'reason', errors);
    record.occurred_at = parseTimestamp(record, 'occurred_at', errors, { required: true });
    record.performed_by = parseRequired(record, 'performed_by', errors);
    if (record.old_due_date && record.new_due_date) {
      const difference =
        (new Date(`${record.new_due_date}T00:00:00Z`) -
          new Date(`${record.old_due_date}T00:00:00Z`)) /
        86_400_000;
      if (difference < 1 || difference > 30) {
        errors.push(issue(record._file, record._row, 'new_due_date', 'Продовження: від 1 до 30 днів.'));
      }
    }
  }
}

function normalizeCopyEvents(records, errors) {
  normalizeCommon(records, errors);
  for (const record of records) {
    record.copy_source_id = parseRequired(record, 'copy_source_id', errors);
    record.kind = parseRequired(record, 'kind', errors);
    record.old_value = parseOptional(record, 'old_value');
    record.new_value = parseOptional(record, 'new_value');
    record.reason = parseOptional(record, 'reason');
    record.occurred_at = parseTimestamp(record, 'occurred_at', errors, { required: true });
    record.performed_by = parseRequired(record, 'performed_by', errors);
  }
}

function normalizeReaderBlocks(records, errors) {
  normalizeCommon(records, errors);
  const activeReaders = new Set();
  for (const record of records) {
    record.reader_source_id = parseRequired(record, 'reader_source_id', errors);
    record.loan_source_id = parseRequired(record, 'loan_source_id', errors);
    record.reason_code = parseEnum(
      record,
      'reason_code',
      new Set(['overdue', 'unresolved_loss']),
      errors,
    );
    record.confirmed_at = parseTimestamp(record, 'confirmed_at', errors, { required: true });
    record.confirmed_by = parseRequired(record, 'confirmed_by', errors);
    record.minimum_until = parseDate(record, 'minimum_until', errors);
    record.is_indefinite = parseBoolean(record, 'is_indefinite', errors);
    record.resolved_at = parseTimestamp(record, 'resolved_at', errors);
    record.resolved_by = parseOptional(record, 'resolved_by');
    record.resolution_comment = parseOptional(record, 'resolution_comment');
    record.annulled_at = parseTimestamp(record, 'annulled_at', errors);
    record.annulled_by = parseOptional(record, 'annulled_by');
    record.annul_reason = parseOptional(record, 'annul_reason');
    if (record.is_indefinite === true && record.minimum_until) {
      errors.push(issue(record._file, record._row, 'minimum_until', 'Для безстрокового блоку поле порожнє.'));
    }
    if (record.is_indefinite === false && !record.minimum_until) {
      errors.push(issue(record._file, record._row, 'minimum_until', 'Для строкового блоку потрібна дата.'));
    }
    if (record.resolved_at && record.annulled_at) {
      errors.push(issue(record._file, record._row, 'resolved_at', 'Блок не може бути і знятий, і анульований.'));
    }
    if ((record.resolved_at && !record.resolved_by) || (!record.resolved_at && record.resolved_by)) {
      errors.push(issue(record._file, record._row, 'resolved_by', 'Виконавець і час зняття задаються разом.'));
    }
    if (
      (record.annulled_at && (!record.annulled_by || !record.annul_reason)) ||
      (!record.annulled_at && (record.annulled_by || record.annul_reason))
    ) {
      errors.push(
        issue(record._file, record._row, 'annulled_by', 'Анулювання потребує часу, виконавця і причини.'),
      );
    }
    if (!record.resolved_at && !record.annulled_at && record.reader_source_id) {
      if (activeReaders.has(record.reader_source_id)) {
        errors.push(
          issue(record._file, record._row, 'reader_source_id', 'Читач має два активні блокування.'),
        );
      }
      activeReaders.add(record.reader_source_id);
    }
  }
}

function normalizeUnblockRequests(records, errors) {
  normalizeCommon(records, errors);
  const pendingBlocks = new Set();
  for (const record of records) {
    record.block_source_id = parseRequired(record, 'block_source_id', errors);
    record.requested_at = parseTimestamp(record, 'requested_at', errors, { required: true });
    record.requested_by = parseRequired(record, 'requested_by', errors);
    record.request_comment = parseOptional(record, 'request_comment');
    record.decision = parseEnum(
      record,
      'decision',
      new Set(['pending', 'approved', 'rejected']),
      errors,
    );
    record.decided_at = parseTimestamp(record, 'decided_at', errors);
    record.decided_by = parseOptional(record, 'decided_by');
    record.decision_comment = parseOptional(record, 'decision_comment');
    if (
      (record.decision === 'pending' && (record.decided_at || record.decided_by)) ||
      (['approved', 'rejected'].includes(record.decision) &&
        (!record.decided_at || !record.decided_by))
    ) {
      errors.push(issue(record._file, record._row, 'decision', 'Рішення не узгоджене з виконавцем і часом.'));
    }
    if (record.decision === 'pending' && record.block_source_id) {
      if (pendingBlocks.has(record.block_source_id)) {
        errors.push(
          issue(record._file, record._row, 'block_source_id', 'Блок має два нерозглянуті запити.'),
        );
      }
      pendingBlocks.add(record.block_source_id);
    }
  }
}

function addMissingReference(errors, record, field, targetName) {
  errors.push(
    issue(record._file, record._row, field, `Посилання не знайдено у ${targetName}.`),
  );
}

function validateRelations(data, errors) {
  const ids = Object.fromEntries(
    Object.entries(data).map(([key, records]) => [key, new Set(records.map((row) => row.source_id))]),
  );
  for (const row of data.copies) {
    if (row.book_source_id && !ids.books.has(row.book_source_id)) {
      addMissingReference(errors, row, 'book_source_id', 'books.csv');
    }
  }
  for (const row of data.loans) {
    if (row.reader_source_id && !ids.readers.has(row.reader_source_id)) {
      addMissingReference(errors, row, 'reader_source_id', 'readers.csv');
    }
    if (row.copy_source_id && !ids.copies.has(row.copy_source_id)) {
      addMissingReference(errors, row, 'copy_source_id', 'copies.csv');
    }
    const copy = data.copies.find((item) => item.source_id === row.copy_source_id);
    if (['lost', 'compensated'].includes(row.status) && copy && copy.is_lost !== true) {
      errors.push(
        issue(row._file, row._row, 'status', 'Втрачена або відшкодована видача потребує is_lost=true у примірника.'),
      );
    }
    if (row.status === 'issued' && copy?.is_lost === true) {
      errors.push(
        issue(row._file, row._row, 'status', 'Виданий примірник не може мати is_lost=true.'),
      );
    }
  }
  for (const row of [...data.loanEvents, ...data.loanExtensions]) {
    if (row.loan_source_id && !ids.loans.has(row.loan_source_id)) {
      addMissingReference(errors, row, 'loan_source_id', 'loans.csv');
    }
  }
  for (const row of data.copyEvents) {
    if (row.copy_source_id && !ids.copies.has(row.copy_source_id)) {
      addMissingReference(errors, row, 'copy_source_id', 'copies.csv');
    }
  }
  for (const row of data.readerBlocks) {
    if (row.reader_source_id && !ids.readers.has(row.reader_source_id)) {
      addMissingReference(errors, row, 'reader_source_id', 'readers.csv');
    }
    if (row.loan_source_id && !ids.loans.has(row.loan_source_id)) {
      addMissingReference(errors, row, 'loan_source_id', 'loans.csv');
    }
  }
  for (const row of data.unblockRequests) {
    if (row.block_source_id && !ids.readerBlocks.has(row.block_source_id)) {
      addMissingReference(errors, row, 'block_source_id', 'reader_blocks.csv');
    }
  }

  const eventsByLoan = Map.groupBy(data.loanEvents, (row) => row.loan_source_id);
  for (const loan of data.loans) {
    const events = (eventsByLoan.get(loan.source_id) ?? []).toSorted(
      (left, right) => new Date(left.occurred_at) - new Date(right.occurred_at),
    );
    if (events.length === 0) {
      if (loan.status === 'lost') {
        errors.push(
          issue(loan._file, loan._row, 'status', 'Для втраченої видачі потрібна історична подія loss.'),
        );
      }
      continue;
    }
    if (events[0].from_status !== null || events[0].to_status !== 'issued') {
      errors.push(
        issue(events[0]._file, events[0]._row, 'to_status', 'Перша подія має фіксувати видачу.'),
      );
    }
    let previous = null;
    for (const event of events) {
      if (event.from_status !== previous) {
        errors.push(
          issue(event._file, event._row, 'from_status', 'Ланцюжок статусів не є послідовним.'),
        );
      }
      previous = event.to_status;
    }
    if (previous !== loan.status) {
      errors.push(
        issue(loan._file, loan._row, 'status', 'Остання подія не відповідає поточному статусу.'),
      );
    }
  }

  const extensionsByLoan = new Map(data.loanExtensions.map((row) => [row.loan_source_id, row]));
  for (const loan of data.loans) {
    const extension = extensionsByLoan.get(loan.source_id);
    if (extension) {
      if (
        extension.old_due_date !== loan.initial_due_date ||
        extension.new_due_date !== loan.current_due_date
      ) {
        errors.push(
          issue(
            extension._file,
            extension._row,
            'new_due_date',
            'Дати продовження не відповідають строкам у loans.csv.',
          ),
        );
      }
    } else if (loan.initial_due_date !== loan.current_due_date) {
      errors.push(
        issue(loan._file, loan._row, 'current_due_date', 'Для зміненого строку потрібен loan_extensions.csv.'),
      );
    }
  }
}

function cleanRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')));
}

async function readCsv(directory, definition, errors, hash) {
  const path = join(directory, definition.name);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (definition.required) {
        errors.push(issue(definition.name, null, null, 'Обов’язковий файл відсутній.'));
      }
      return [];
    }
    throw error;
  }

  hash.update(definition.name).update('\0').update(text).update('\0');
  let actualHeaders = [];
  try {
    const records = parse(text, {
      bom: true,
      delimiter: ';',
      columns(headers) {
        actualHeaders = headers.map((header) => header.trim());
        return actualHeaders;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    });
    if (actualHeaders.join('\0') !== definition.headers.join('\0')) {
      errors.push(
        issue(
          definition.name,
          1,
          null,
          `Очікувані колонки: ${definition.headers.join(';')}.`,
        ),
      );
      return [];
    }
    if (definition.required && records.length === 0) {
      errors.push(issue(definition.name, null, null, 'Обов’язковий файл не містить записів.'));
    }
    return records.map((record, index) => ({
      ...record,
      _file: definition.name,
      _row: index + 2,
    }));
  } catch (error) {
    errors.push(issue(definition.name, error.lines ?? null, null, `CSV не читається: ${error.message}`));
    return [];
  }
}

export async function loadImportPackage(directory, { now = new Date() } = {}) {
  const absoluteDirectory = resolve(directory);
  const errors = [];
  const hash = createHash('sha256');
  const data = {};

  for (const definition of FILES) {
    data[definition.key] = await readCsv(absoluteDirectory, definition, errors, hash);
  }

  const currentYear = Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric' }).format(now),
  );
  normalizeBooks(data.books, errors, currentYear);
  normalizeCopies(data.copies, errors);
  normalizeReaders(data.readers, errors);
  normalizeLoans(data.loans, errors);
  normalizeLoanEvents(data.loanEvents, errors);
  normalizeLoanExtensions(data.loanExtensions, errors);
  normalizeCopyEvents(data.copyEvents, errors);
  normalizeReaderBlocks(data.readerBlocks, errors);
  normalizeUnblockRequests(data.unblockRequests, errors);
  validateRelations(data, errors);

  if (errors.length) throw new ImportPackageError(errors);

  const cleaned = Object.fromEntries(
    Object.entries(data).map(([key, records]) => [key, records.map(cleanRecord)]),
  );
  return {
    directory: absoluteDirectory,
    contentHash: hash.digest('hex'),
    data: cleaned,
    recordCounts: Object.fromEntries(
      FILES.map((definition) => [definition.name, data[definition.key].length]),
    ),
  };
}

export const importFileDefinitions = FILES.map(({ key, name, required, headers }) => ({
  key,
  name,
  required,
  headers: [...headers],
}));
