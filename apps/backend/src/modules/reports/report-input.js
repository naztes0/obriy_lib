import { AppError } from '../../http/app-error.js';
import { readPagination } from '../../http/pagination.js';
import { isValidDate } from '../loans/loan-input.js';

export const REPORT_TYPES = new Set([
  'fund',
  'current-loans',
  'overdue-loans',
  'unresolved-losses',
  'blocks',
  'damaged-copies',
  'reader-activity',
]);

function invalidQuery(fields) {
  throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри звіту.', { fields });
}

function optionalDate(searchParams, name, errors) {
  const value = searchParams.get(name);
  if (value === null || value === '') return null;
  if (!isValidDate(value)) {
    errors[name] = 'Вкажіть коректну дату у форматі YYYY-MM-DD.';
    return null;
  }
  return value;
}

function optionalClassName(searchParams, errors) {
  const value = searchParams.get('className')?.trim().replace(/\s+/gu, ' ') ?? '';
  if (value.length > 64) {
    errors.className = 'Назва класу не може містити більше 64 символів.';
  }
  return value || null;
}

export function readReportQuery(reportType, searchParams) {
  if (!REPORT_TYPES.has(reportType)) {
    throw new AppError(404, 'REPORT_NOT_FOUND', 'Такий звіт не передбачений.');
  }

  const errors = {};
  const dateFrom = optionalDate(searchParams, 'dateFrom', errors);
  const dateTo = optionalDate(searchParams, 'dateTo', errors);
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    errors.dateTo = 'Кінцева дата не може бути ранішою за початкову.';
  }

  const category = searchParams.get('category');
  if (category !== null && !['student', 'employee'].includes(category)) {
    errors.category = 'Допустимі значення: student або employee.';
  }

  const blockStatus = searchParams.get('blockStatus') ?? 'active';
  if (!['active', 'resolved', 'annulled', 'all'].includes(blockStatus)) {
    errors.blockStatus = 'Допустимі значення: active, resolved, annulled або all.';
  }

  const className = optionalClassName(searchParams, errors);
  if (Object.keys(errors).length) invalidQuery(errors);

  return {
    filters: {
      dateFrom,
      dateTo,
      category,
      className,
      blockStatus,
    },
    pagination: readPagination(searchParams),
  };
}
