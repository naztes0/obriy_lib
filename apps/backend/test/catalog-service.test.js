import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogService } from '../src/modules/catalog/catalog-service.js';

test('catalog combines filters and calculates pagination metadata', async () => {
  let received;
  const service = new CatalogService({
    listBooks: async (query) => {
      received = query;
      return { books: [{ id: '26' }], totalItems: 51 };
    },
  });
  const search = new URLSearchParams({
    title: ' коб ',
    author: 'Шевченко',
    publisher: 'Дніпро',
    archived: 'all',
    page: '2',
    pageSize: '25',
  });

  const result = await service.listBooks(search);

  assert.deepEqual(received, {
    filters: {
      title: 'коб',
      author: 'Шевченко',
      publisher: 'Дніпро',
      archived: 'all',
    },
    pageSize: 25,
    offset: 25,
  });
  assert.deepEqual(result.meta, {
    page: 2,
    pageSize: 25,
    totalItems: 51,
    totalPages: 3,
  });
});

test('catalog rejects an invalid page size before querying the database', async () => {
  let queried = false;
  const service = new CatalogService({
    listBooks: async () => {
      queried = true;
    },
  });

  await assert.rejects(
    service.listBooks(new URLSearchParams({ pageSize: '101' })),
    (error) => error.code === 'INVALID_QUERY' && error.status === 400,
  );
  assert.equal(queried, false);
});

test('catalog returns a specific error when a book does not exist', async () => {
  const service = new CatalogService({ findBookById: async () => null });

  await assert.rejects(
    service.getBook('999'),
    (error) => error.code === 'BOOK_NOT_FOUND' && error.status === 404,
  );
});

test('catalog creates a validated book with a normalized ISBN', async () => {
  let created;
  const repository = {
    findBookByNormalizedIsbn: async (isbn) => {
      assert.equal(isbn, '9780306406157');
      return null;
    },
    createBook: async (book) => {
      created = book;
      return '12';
    },
    findBookById: async () => ({ id: '12', title: 'Фізика', copies: [] }),
  };
  const service = new CatalogService(repository, {
    now: () => new Date('2026-10-30T10:00:00Z'),
  });

  const result = await service.createBook({
    title: '  Фізика  ',
    authors: [' Іваненко   Іван ', 'Іваненко Іван'],
    publisher: ' Наука ',
    publicationYear: 2020,
    isbn: '978-0-306-40615-7',
    isTextbook: true,
  });

  assert.equal(result.id, '12');
  assert.deepEqual(created, {
    title: 'Фізика',
    authors: ['Іваненко Іван'],
    publisher: 'Наука',
    publicationYear: 2020,
    isbn: '978-0-306-40615-7',
    isbnNormalized: '9780306406157',
    isTextbook: true,
  });
});

test('catalog rejects a duplicate ISBN and returns the existing book', async () => {
  const existing = { id: '2', title: 'Наявна книга', isArchived: false };
  const service = new CatalogService(
    {
      findBookByNormalizedIsbn: async () => existing,
      createBook: async () => assert.fail('createBook must not be called'),
    },
    { now: () => new Date('2026-10-30T10:00:00Z') },
  );

  await assert.rejects(
    service.createBook({
      title: 'Інша назва',
      authors: ['Автор'],
      publisher: 'Видавництво',
      publicationYear: null,
      isbn: '9780306406157',
      isTextbook: false,
    }),
    (error) =>
      error.code === 'ISBN_ALREADY_EXISTS' &&
      error.status === 409 &&
      error.details.book === existing,
  );
});

test('catalog requires explicit confirmation for a possible duplicate without ISBN', async () => {
  const match = { id: '3', title: 'Кобзар', authors: [{ name: 'Тарас Шевченко' }] };
  const repository = {
    findPossibleDuplicates: async () => [match],
    createBook: async () => assert.fail('createBook must not be called'),
  };
  const service = new CatalogService(repository, {
    now: () => new Date('2026-10-30T10:00:00Z'),
  });

  await assert.rejects(
    service.createBook({
      title: 'Кобзар',
      authors: ['Тарас Шевченко'],
      publisher: 'Дніпро',
      publicationYear: null,
      isbn: null,
      isTextbook: false,
    }),
    (error) =>
      error.code === 'POSSIBLE_BOOK_DUPLICATE' &&
      error.details.confirmation.field === 'confirmDuplicate',
  );
});

test('catalog updates only supplied fields and keeps the remaining book data', async () => {
  let updated;
  const repository = {
    findBookById: async () => ({
      id: '4',
      title: 'Стара назва',
      authors: [{ id: '1', name: 'Автор' }],
      publisher: 'Старе видавництво',
      publicationYear: 2000,
      isbn: '9780306406157',
      isTextbook: false,
      isArchived: false,
      copies: [],
    }),
    findBookByNormalizedIsbn: async () => null,
    updateBook: async (bookId, book) => {
      assert.equal(bookId, '4');
      updated = book;
      return true;
    },
  };
  const service = new CatalogService(repository, {
    now: () => new Date('2026-10-30T10:00:00Z'),
  });

  await service.updateBook('4', { publisher: 'Нове видавництво' });

  assert.deepEqual(updated, {
    title: 'Стара назва',
    authors: ['Автор'],
    publisher: 'Нове видавництво',
    publicationYear: 2000,
    isbn: '9780306406157',
    isbnNormalized: '9780306406157',
    isTextbook: false,
  });
});

test('catalog rejects an invalid ISBN and a future publication year', async () => {
  const service = new CatalogService({}, {
    now: () => new Date('2026-10-30T10:00:00Z'),
  });

  await assert.rejects(
    service.createBook({
      title: 'Книга',
      authors: ['Автор'],
      publisher: 'Видавництво',
      publicationYear: 2027,
      isbn: '123',
      isTextbook: false,
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      Boolean(error.details.fields.publicationYear) &&
      Boolean(error.details.fields.isbn),
  );
});
