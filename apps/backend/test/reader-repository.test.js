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

test('reader repository generates a six-digit electronic ticket number', async () => {
  let insertedTicketNumber;
  const client = {
    query: async (sql, parameters = []) => {
      if (sql.includes('FROM school_classes')) return { rowCount: 1, rows: [{ id: '2' }] };
      if (sql.includes("nextval('electronic_ticket_number_seq')")) {
        return { rowCount: 1, rows: [{ value: '42' }] };
      }
      if (sql.includes('SELECT 1 FROM reader_personal_data WHERE upper(ticket_number)')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO readers DEFAULT VALUES')) {
        return { rowCount: 1, rows: [{ id: '10' }] };
      }
      if (sql.includes('INSERT INTO reader_personal_data (')) {
        insertedTicketNumber = parameters[6];
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => {},
  };
  const repository = new ReaderRepository({ connect: async () => client });

  const result = await repository.createReader(
    {
      fullName: 'Учень Тестовий',
      category: 'student',
      classId: '2',
      phone: '+380501234567',
      address: null,
      ticketType: 'electronic',
      ticketNumber: null,
      ticketExpiresOn: '2027-06-30',
    },
    '2',
    '2026-11-15',
  );

  assert.equal(insertedTicketNumber, 'E-000042');
  assert.deepEqual(result, { status: 'created', readerId: '10' });
});
