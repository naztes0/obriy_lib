import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryRepository } from '../src/modules/readers/history-repository.js';
import { HistoryService } from '../src/modules/readers/history-service.js';

test('history service validates filters and builds pagination metadata', async () => {
  let received;
  const repository = {
    listReaderHistory: async (readerId, query) => {
      received = { readerId, query };
      return { items: [{ id: '10' }], totalItems: 21 };
    },
  };
  const service = new HistoryService(repository);
  const result = await service.listReaderHistory(
    '4',
    new URLSearchParams({
      dateFrom: '2026-09-01',
      dateTo: '2026-11-30',
      page: '2',
      pageSize: '10',
    }),
  );

  assert.deepEqual(received, {
    readerId: '4',
    query: {
      dateFrom: '2026-09-01',
      dateTo: '2026-11-30',
      pageSize: 10,
      offset: 10,
    },
  });
  assert.deepEqual(result, {
    data: [{ id: '10' }],
    meta: { page: 2, pageSize: 10, totalItems: 21, totalPages: 3 },
  });
});

test('history service rejects invalid identifiers and periods', async () => {
  const service = new HistoryService({
    listReaderHistory: async () => assert.fail('repository must not be called'),
    listLoanAudit: async () => assert.fail('repository must not be called'),
  });

  await assert.rejects(
    service.listReaderHistory('wrong', new URLSearchParams()),
    (error) => error.code === 'INVALID_READER_ID',
  );
  await assert.rejects(
    service.listReaderHistory(
      '4',
      new URLSearchParams({ dateFrom: '2026-12-01', dateTo: '2026-11-01' }),
    ),
    (error) => error.code === 'INVALID_QUERY',
  );
  await assert.rejects(
    service.listLoanAudit('0'),
    (error) => error.code === 'INVALID_LOAN_ID',
  );
});

test('history repository keeps SQL parameters separate from query text', async () => {
  const calls = [];
  const pool = {
    query: async (text, values) => {
      calls.push({ text, values });
      if (calls.length === 1) return { rows: [{ count: '1' }] };
      return { rows: [{ id: '7', title: 'Фізика' }] };
    },
  };
  const repository = new HistoryRepository(pool);
  const result = await repository.listReaderHistory('4', {
    dateFrom: '2026-09-01',
    dateTo: null,
    pageSize: 25,
    offset: 0,
  });

  assert.deepEqual(result, { items: [{ id: '7', title: 'Фізика' }], totalItems: 1 });
  assert.deepEqual(calls[0].values, ['4', '2026-09-01', null]);
  assert.deepEqual(calls[1].values, ['4', '2026-09-01', null, 25, 0]);
  assert.match(calls[1].text, /LIMIT \$4 OFFSET \$5/);
});
