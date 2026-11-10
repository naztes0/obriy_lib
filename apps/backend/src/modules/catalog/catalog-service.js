import { AppError } from '../../http/app-error.js';
import { readPagination } from '../../http/pagination.js';
import {
  normalizeComparableText,
  normalizeIsbn,
  validateBookArchive,
  validateBookCreate,
  validateBookDelete,
  validateBookIdempotencyKey,
  validateBookRestore,
  validateBookUpdate,
} from './book-input.js';

const FILTER_LIMIT = 200;

function readTextFilter(searchParams, name) {
  const value = searchParams.get(name)?.trim() ?? '';
  if (value.length > FILTER_LIMIT) {
    throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
      fields: { [name]: `Значення не може містити більше ${FILTER_LIMIT} символів.` },
    });
  }
  return value || null;
}

export class CatalogService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async listBooks(searchParams) {
    const pagination = readPagination(searchParams);
    const archived = searchParams.get('archived') ?? 'active';
    if (!['active', 'archived', 'all'].includes(archived)) {
      throw new AppError(400, 'INVALID_QUERY', 'Перевірте параметри запиту.', {
        fields: { archived: 'Допустимі значення: active, archived або all.' },
      });
    }

    const result = await this.repository.listBooks({
      filters: {
        title: readTextFilter(searchParams, 'title'),
        author: readTextFilter(searchParams, 'author'),
        publisher: readTextFilter(searchParams, 'publisher'),
        archived,
      },
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });

    return {
      data: result.books,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / pagination.pageSize),
      },
    };
  }

  async getBook(bookId) {
    if (!/^[1-9][0-9]*$/.test(bookId)) {
      throw new AppError(400, 'INVALID_BOOK_ID', 'Некоректний ідентифікатор книги.');
    }

    const book = await this.repository.findBookById(bookId);
    if (!book) {
      throw new AppError(404, 'BOOK_NOT_FOUND', 'Книгу не знайдено.');
    }
    return book;
  }

  async checkDuplicates(book, { excludeBookId = null, confirmDuplicate = false } = {}) {
    if (book.isbnNormalized) {
      const duplicate = await this.repository.findBookByNormalizedIsbn(
        book.isbnNormalized,
        excludeBookId,
      );
      if (duplicate) {
        throw new AppError(
          409,
          'ISBN_ALREADY_EXISTS',
          'Книга з таким ISBN уже існує. Відкрийте її та додайте примірник до наявного запису.',
          { book: duplicate },
        );
      }
      return;
    }

    const matches = await this.repository.findPossibleDuplicates({
      titleNormalized: normalizeComparableText(book.title),
      authorsNormalized: book.authors.map(normalizeComparableText).sort(),
      publicationYear: book.publicationYear,
      excludeBookId,
    });
    if (matches.length > 0 && !confirmDuplicate) {
      throw new AppError(
        409,
        'POSSIBLE_BOOK_DUPLICATE',
        'Знайдено схоже видання без ISBN. Перевірте його або підтвердьте збереження окремої книги.',
        {
          matches,
          confirmation: { field: 'confirmDuplicate', value: true },
        },
      );
    }
  }

  async createBook(input) {
    const { values, confirmDuplicate } = validateBookCreate(input, this.now());
    await this.checkDuplicates(values, { confirmDuplicate });

    try {
      const bookId = await this.repository.createBook(values);
      return await this.getBook(bookId);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'books_isbn_unique') {
        const duplicate = await this.repository.findBookByNormalizedIsbn(values.isbnNormalized);
        throw new AppError(
          409,
          'ISBN_ALREADY_EXISTS',
          'Книга з таким ISBN уже існує. Відкрийте її та додайте примірник до наявного запису.',
          { book: duplicate },
        );
      }
      throw error;
    }
  }

  async updateBook(bookId, input) {
    const existing = await this.getBook(bookId);
    if (existing.isArchived) {
      throw new AppError(
        422,
        'BOOK_ARCHIVED',
        'Архівну книгу не можна редагувати. Спочатку відновіть її.',
      );
    }

    const { values: changes, confirmDuplicate } = validateBookUpdate(input, this.now());
    const has = (field) => Object.hasOwn(changes, field);
    const book = {
      title: has('title') ? changes.title : existing.title,
      authors: has('authors') ? changes.authors : existing.authors.map((author) => author.name),
      publisher: has('publisher') ? changes.publisher : existing.publisher,
      publicationYear: has('publicationYear') ? changes.publicationYear : existing.publicationYear,
      isbn: has('isbn') ? changes.isbn : existing.isbn,
      isbnNormalized: has('isbnNormalized')
        ? changes.isbnNormalized
        : existing.isbn
          ? normalizeIsbn(existing.isbn)
          : null,
      isTextbook: has('isTextbook') ? changes.isTextbook : existing.isTextbook,
    };

    await this.checkDuplicates(book, { excludeBookId: bookId, confirmDuplicate });

    try {
      const updated = await this.repository.updateBook(bookId, book);
      if (!updated) {
        throw new AppError(
          409,
          'BOOK_STATE_CHANGED',
          'Стан книги змінився. Оновіть сторінку та повторіть дію.',
        );
      }
      return await this.getBook(bookId);
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'books_isbn_unique') {
        const duplicate = await this.repository.findBookByNormalizedIsbn(
          book.isbnNormalized,
          bookId,
        );
        throw new AppError(
          409,
          'ISBN_ALREADY_EXISTS',
          'Книга з таким ISBN уже існує. Відкрийте її та додайте примірник до наявного запису.',
          { book: duplicate },
        );
      }
      throw error;
    }
  }

  async archiveBook(bookId, input, actor, idempotencyKey) {
    this.validateBookId(bookId);
    const values = validateBookArchive(input);
    const requestKey = validateBookIdempotencyKey(idempotencyKey);
    const result = await this.repository.archiveBook(bookId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    this.assertLifecycleResult(result, {
      already_archived: [422, 'BOOK_ALREADY_ARCHIVED', 'Видання вже перебуває в архіві.'],
      open_loans: [
        422,
        'BOOK_HAS_OPEN_LOANS',
        'Видання не можна архівувати, доки хоча б один примірник має незавершену видачу.',
      ],
    });
    return await this.getBook(result.bookId);
  }

  async restoreBook(bookId, input, actor, idempotencyKey) {
    this.validateBookId(bookId);
    const values = validateBookRestore(input);
    const requestKey = validateBookIdempotencyKey(idempotencyKey);
    const result = await this.repository.restoreBook(bookId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    this.assertLifecycleResult(result, {
      not_archived: [422, 'BOOK_NOT_ARCHIVED', 'Видання не перебуває в архіві.'],
    });
    return await this.getBook(result.bookId);
  }

  async deleteUnusedBook(bookId, input, actor, idempotencyKey) {
    this.validateBookId(bookId);
    const values = validateBookDelete(input);
    const requestKey = validateBookIdempotencyKey(idempotencyKey);
    const result = await this.repository.deleteUnusedBook(bookId, {
      ...values,
      actorId: actor.id,
      requestKey,
    });
    this.assertLifecycleResult(result, {
      has_copies: [
        422,
        'BOOK_HAS_COPIES',
        'Спочатку опрацюйте всі примірники цього видання.',
      ],
      has_history: [
        422,
        'BOOK_HAS_HISTORY',
        'Видання має історію. Його можна архівувати, але не фізично видалити.',
      ],
    });
    return { id: result.bookId, deleted: true };
  }

  validateBookId(bookId) {
    if (!/^[1-9][0-9]*$/.test(bookId)) {
      throw new AppError(400, 'INVALID_BOOK_ID', 'Некоректний ідентифікатор видання.');
    }
  }

  assertLifecycleResult(result, errors) {
    if (result.status === 'not_found') {
      throw new AppError(404, 'BOOK_NOT_FOUND', 'Видання не знайдено.');
    }
    if (result.status === 'version_conflict') {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'Видання вже змінилося. Оновіть дані та повторіть дію.',
      );
    }
    if (errors[result.status]) {
      const [status, code, message] = errors[result.status];
      throw new AppError(status, code, message);
    }
  }
}
