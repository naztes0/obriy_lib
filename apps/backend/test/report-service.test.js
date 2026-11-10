import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportService } from '../src/modules/reports/report-service.js';

test('report service passes filters, pagination and current Kyiv date', async () => {
  let received;
  const service = new ReportService(
    {
      getReport: async (type, query) => {
        received = { type, query };
        return {
          items: [{ id: '7' }],
          totalItems: 51,
          summary: { loans: 51, readers: 20 },
        };
      },
    },
    { now: () => new Date('2026-11-10T22:30:00.000Z') },
  );
  const search = new URLSearchParams({
    dateFrom: '2026-09-01',
    dateTo: '2026-11-10',
    category: 'student',
    className: ' 11-А ',
    page: '2',
    pageSize: '25',
  });

  const result = await service.getReport('overdue-loans', search);

  assert.deepEqual(received, {
    type: 'overdue-loans',
    query: {
      filters: {
        dateFrom: '2026-09-01',
        dateTo: '2026-11-10',
        category: 'student',
        className: '11-А',
        blockStatus: 'active',
      },
      today: '2026-11-11',
      pageSize: 25,
      offset: 25,
    },
  });
  assert.deepEqual(result.meta, {
    page: 2,
    pageSize: 25,
    totalItems: 51,
    totalPages: 3,
    summary: { loans: 51, readers: 20 },
  });
});

test('report service rejects an unknown report before querying', async () => {
  const service = new ReportService({
    getReport: async () => assert.fail('repository must not be called'),
  });

  await assert.rejects(
    service.getReport('unknown', new URLSearchParams()),
    (error) => error.status === 404 && error.code === 'REPORT_NOT_FOUND',
  );
});

test('report service rejects an invalid period and category', async () => {
  const service = new ReportService({
    getReport: async () => assert.fail('repository must not be called'),
  });

  await assert.rejects(
    service.getReport(
      'reader-activity',
      new URLSearchParams({
        dateFrom: '2026-12-01',
        dateTo: '2026-11-01',
        category: 'guest',
      }),
    ),
    (error) =>
      error.status === 400 &&
      error.code === 'INVALID_QUERY' &&
      Boolean(error.details.fields.dateTo) &&
      Boolean(error.details.fields.category),
  );
});

test('blocks report accepts explicit history status', async () => {
  let received;
  const service = new ReportService({
    getReport: async (_type, query) => {
      received = query;
      return { items: [], totalItems: 0, summary: { blocks: 0 } };
    },
  });

  await service.getReport('blocks', new URLSearchParams({ blockStatus: 'all' }));

  assert.equal(received.filters.blockStatus, 'all');
});
