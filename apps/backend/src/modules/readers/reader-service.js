import { AppError } from '../../http/app-error.js';
import { readPagination } from '../../http/pagination.js';
import {
  normalizeComparableName,
  validateReaderArchive,
  validateReaderCreate,
  validateReaderIdempotencyKey,
  validateReaderRestore,
  validateReaderUpdate,
} from './reader-input.js';

const FILTER_LIMIT = 200;

function validateReaderId(readerId) {
  if (!/^[1-9][0-9]*$/.test(readerId)) {
    throw new AppError(400, 'INVALID_READER_ID', 'Некоректний ідентифікатор читача.');
  }
}

function todayInKyiv(now) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function namesakeError(matches) {
  return new AppError(
    409,
    'NAMESAKE_WARNING',
    'Знайдено читачів з таким самим ПІБ. Перевірте номери квитків.',
    { matches, confirmation: { field: 'confirmNamesake', value: true } },
  );
}

function ticketNumberExistsError() {
  return new AppError(409, 'TICKET_NUMBER_EXISTS', 'Читач із таким номером квитка вже існує.');
}

function versionConflict() {
  return new AppError(
    409,
    'VERSION_CONFLICT',
    'Картка вже змінилася. Оновіть дані та повторіть дію.',
  );
}

export class ReaderService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async listReaders(searchParams) {
    const pagination = readPagination(searchParams);
    const query = searchParams.get('q')?.trim() ?? '';
    if (query.length > FILTER_LIMIT) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { q: `Значення не може містити більше ${FILTER_LIMIT} символів.` },
      });
    }
    const archived = searchParams.get('archived') ?? 'active';
    if (!['active', 'archived', 'all'].includes(archived)) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { archived: 'Допустимі значення: active, archived або all.' },
      });
    }

    const result = await this.repository.listReaders({
      query: query || null,
      archived,
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });
    return {
      data: result.readers,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
      },
    };
  }

  async getReader(readerId) {
    validateReaderId(readerId);
    const reader = await this.repository.findById(readerId);
    if (!reader) throw new AppError(404, 'READER_NOT_FOUND', 'Читача не знайдено.');
    return reader;
  }

  async checkNamesakes(fullName, { excludeReaderId = null, confirmed = false } = {}) {
    const matches = await this.repository.findNamesakes(
      normalizeComparableName(fullName),
      excludeReaderId,
    );
    if (matches.length && !confirmed) throw namesakeError(matches);
  }

  async createReader(input, actor) {
    const { values, confirmNamesake } = validateReaderCreate(input);
    await this.checkNamesakes(values.fullName, { confirmed: confirmNamesake });

    const maximumAttempts = values.ticketType === 'electronic' ? 3 : 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const result = await this.repository.createReader(
          values,
          actor.id,
          todayInKyiv(this.now()),
        );
        if (result.status === 'class_unavailable') {
          throw new AppError(
            422,
            'CLASS_UNAVAILABLE',
            'Вибраний клас не існує або деактивований.',
          );
        }
        return await this.getReader(result.readerId);
      } catch (error) {
        const duplicateTicket =
          error.code === '23505' && error.constraint === 'reader_ticket_number_unique';
        if (!duplicateTicket) throw error;
        if (values.ticketType === 'existing' || attempt === maximumAttempts) {
          throw ticketNumberExistsError();
        }
      }
    }
    throw ticketNumberExistsError();
  }

  async updateReader(readerId, input, actor) {
    const existing = await this.getReader(readerId);
    const update = validateReaderUpdate(input, existing);
    const nameChanged =
      normalizeComparableName(update.values.fullName) !== normalizeComparableName(existing.fullName);
    const ticketChanged = update.values.ticketNumber !== existing.ticketNumber;

    const archivedEditableFields = new Set(['ticketNumber', 'ticketExpiresOn']);
    if (existing.isArchived && update.supplied.some((field) => !archivedEditableFields.has(field))) {
      throw new AppError(
        422,
        'READER_ARCHIVED',
        'В архівній картці можна змінити лише номер або строк квитка.',
      );
    }
    if (nameChanged) {
      await this.checkNamesakes(update.values.fullName, {
        excludeReaderId: readerId,
        confirmed: update.confirmNamesake,
      });
    }
    if (ticketChanged) {
      if (actor.role !== 'manager') {
        throw new AppError(403, 'ACCESS_DENIED', 'Змінити номер квитка може лише завідувач.');
      }
      if (!update.confirmTicketNumberChange) {
        throw new AppError(
          409,
          'TICKET_NUMBER_CHANGE_CONFIRMATION_REQUIRED',
          'Підтвердьте зміну номера квитка.',
          {
            oldTicketNumber: existing.ticketNumber,
            newTicketNumber: update.values.ticketNumber,
            confirmation: { field: 'confirmTicketNumberChange', value: true },
          },
        );
      }
      if (!update.reason) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Вкажіть причину зміни номера.', {
          fields: { reason: 'Причина є обов’язковою.' },
        });
      }
    }

    try {
      const result = await this.repository.updateReader(readerId, update.values, {
        actorId: actor.id,
        reason: update.reason,
        expectedTicketNumber: existing.ticketNumber,
      });
      if (result.status === 'not_found') {
        throw new AppError(404, 'READER_NOT_FOUND', 'Читача не знайдено.');
      }
      if (result.status === 'class_unavailable') {
        throw new AppError(422, 'CLASS_UNAVAILABLE', 'Вибраний клас не існує або деактивований.');
      }
      if (result.status === 'ticket_changed') {
        throw new AppError(
          409,
          'READER_STATE_CHANGED',
          'Номер квитка вже змінився. Оновіть картку та повторіть дію.',
        );
      }
      return await this.getReader(readerId);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'reader_ticket_number_unique') {
        throw ticketNumberExistsError();
      }
      throw error;
    }
  }

  async archiveReader(readerId, input, actor, idempotencyKey) {
    validateReaderId(readerId);
    const values = validateReaderArchive(input);
    const requestKey = validateReaderIdempotencyKey(idempotencyKey);
    const result = await this.repository.archiveReader(readerId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    const errors = {
      not_found: [404, 'READER_NOT_FOUND', 'Читача не знайдено.'],
      already_archived: [422, 'READER_ALREADY_ARCHIVED', 'Картка читача вже в архіві.'],
      open_loans: [
        422,
        'READER_HAS_OPEN_LOANS',
        'Спочатку поверніть усі примірники або врегулюйте втрати.',
      ],
    };
    if (result.status === 'version_conflict') throw versionConflict();
    if (errors[result.status]) {
      const [status, code, message] = errors[result.status];
      throw new AppError(status, code, message);
    }
    return await this.getReader(result.readerId);
  }

  async restoreReader(readerId, input, actor, idempotencyKey) {
    validateReaderId(readerId);
    const values = validateReaderRestore(input);
    const requestKey = validateReaderIdempotencyKey(idempotencyKey);
    const result = await this.repository.restoreReader(readerId, {
      ...values,
      today: todayInKyiv(this.now()),
      actorId: actor.id,
      requestKey,
    });
    const errors = {
      not_found: [404, 'READER_NOT_FOUND', 'Читача не знайдено.'],
      not_archived: [422, 'READER_NOT_ARCHIVED', 'Картка читача не перебуває в архіві.'],
      open_loans: [
        422,
        'READER_HAS_OPEN_LOANS',
        'Картку не можна відновити, доки є незавершені видачі.',
      ],
      ticket_expired: [
        422,
        'READER_TICKET_EXPIRED',
        'Строк учнівського квитка завершився. Спочатку оновіть строк.',
      ],
    };
    if (result.status === 'version_conflict') throw versionConflict();
    if (errors[result.status]) {
      const [status, code, message] = errors[result.status];
      throw new AppError(status, code, message);
    }
    return await this.getReader(result.readerId);
  }
}
