import { AppError } from '../../http/app-error.js';
import { readPagination } from '../../http/pagination.js';
import {
  validateConditionChange,
  validateCopyCreate,
  validateTemporaryUnavailability,
} from './copy-input.js';

function validateId(value, entity) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError(400, `INVALID_${entity.toUpperCase()}_ID`, 'Некоректний ідентифікатор.');
  }
}

export class CopyService {
  constructor(repository) {
    this.repository = repository;
  }

  async getCopy(copyId) {
    validateId(copyId, 'copy');
    const copy = await this.repository.findCopyById(copyId);
    if (!copy) throw new AppError(404, 'COPY_NOT_FOUND', 'Примірник не знайдено.');
    return copy;
  }

  async createCopy(bookId, input, actor) {
    validateId(bookId, 'book');
    const values = validateCopyCreate(input);
    try {
      const result = await this.repository.createCopy({ ...values, bookId, actorId: actor.id });
      if (result.status === 'book_not_found') {
        throw new AppError(404, 'BOOK_NOT_FOUND', 'Книгу не знайдено.');
      }
      if (result.status === 'book_archived') {
        throw new AppError(422, 'BOOK_ARCHIVED', 'До архівної книги не можна додати примірник.');
      }
      return await this.getCopy(result.copyId);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'book_copies_inventory_unique') {
        throw new AppError(
          409,
          'INVENTORY_NUMBER_EXISTS',
          'Примірник із таким інвентарним номером уже існує.',
        );
      }
      throw error;
    }
  }

  async changeCondition(copyId, input, actor) {
    validateId(copyId, 'copy');
    const values = validateConditionChange(input);
    const result = await this.repository.changeCondition(copyId, { ...values, actorId: actor.id });
    this.assertMutableResult(result);
    return await this.getCopy(copyId);
  }

  async setTemporaryUnavailability(copyId, input, actor) {
    validateId(copyId, 'copy');
    const values = validateTemporaryUnavailability(input);
    const result = await this.repository.setTemporaryUnavailability(copyId, {
      ...values,
      actorId: actor.id,
    });
    this.assertMutableResult(result);
    return await this.getCopy(copyId);
  }

  assertMutableResult(result) {
    if (result.status === 'not_found') {
      throw new AppError(404, 'COPY_NOT_FOUND', 'Примірник не знайдено.');
    }
    if (result.status === 'archived') {
      throw new AppError(422, 'COPY_ARCHIVED', 'Архівний примірник не можна змінювати.');
    }
  }

  async listHistory(copyId, searchParams) {
    await this.getCopy(copyId);
    const pagination = readPagination(searchParams);
    const result = await this.repository.listHistory(copyId, pagination);
    return {
      data: result.events,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
      },
    };
  }
}
