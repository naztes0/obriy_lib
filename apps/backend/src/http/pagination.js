import { AppError } from './app-error.js';

function parsePositiveInteger(value, fallback, field, maximum) {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
      fields: { [field]: 'Значення має бути додатним цілим числом.' },
    });
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
      fields: { [field]: `Значення не може перевищувати ${maximum}.` },
    });
  }
  return number;
}

export function readPagination(searchParams) {
  const page = parsePositiveInteger(searchParams.get('page'), 1, 'page', 100_000);
  const pageSize = parsePositiveInteger(searchParams.get('pageSize'), 25, 'pageSize', 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
