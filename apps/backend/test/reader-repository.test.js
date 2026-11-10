import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReaderRepository } from '../src/modules/readers/reader-repository.js';

test('reader repository returns PostgreSQL date values as YYYY-MM-DD', async () => {
  const results = [
    {
      rowCount: 1,
      rows: [
        {
          reader_id: '1',
          full_name: 'Учень Тестовий',
          category: 'student',
          class_id: '2',
          class_name: '10-А',
          phone: '+380501234567',
          address: null,
          ticket_number: 'T-1',
          ticket_type: 'electronic',
          ticket_issued_on: new Date(2026, 10, 3),
          ticket_expires_on: new Date(2027, 5, 30),
          employment_ended_on: null,
          is_blocked: false,
          archived_at: null,
          archive_reason: null,
          version: '1',
        },
      ],
    },
    { rowCount: 0, rows: [] },
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ total: '0' }] },
  ];
  const repository = new ReaderRepository({
    query: async () => results.shift(),
  });

  const result = await repository.findById('1');

  assert.equal(result.ticketIssuedOn, '2026-11-03');
  assert.equal(result.ticketExpiresOn, '2027-06-30');
  assert.equal(result.employmentEndedOn, null);
  assert.equal(result.isBlocked, false);
});
