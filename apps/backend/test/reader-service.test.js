import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReaderService } from '../src/modules/readers/reader-service.js';

const librarian = { id: '2', role: 'librarian' };
const manager = { id: '1', role: 'manager' };

function reader(overrides = {}) {
  return {
    id: '10',
    fullName: 'Іваненко Іван Іванович',
    category: 'student',
    schoolClass: { id: '3', name: '10-А' },
    phone: '+380501234567',
    address: null,
    ticketNumber: 'T-10',
    ticketType: 'existing',
    ticketIssuedOn: null,
    ticketExpiresOn: '2027-06-30',
    isArchived: false,
    version: '1',
    currentLoans: [],
    loanHistory: [],
    ...overrides,
  };
}

test('reader list combines search, archive filter and pagination', async () => {
  let received;
  const service = new ReaderService({
    listReaders: async (query) => {
      received = query;
      return { readers: [{ id: '1' }], totalItems: 26 };
    },
  });

  const result = await service.listReaders(
    new URLSearchParams({ q: ' Іван ', archived: 'all', page: '2', pageSize: '25' }),
  );

  assert.deepEqual(received, {
    query: 'Іван',
    archived: 'all',
    pageSize: 25,
    offset: 25,
  });
  assert.equal(result.meta.totalPages, 2);
});

test('reader creation validates a student and passes the actor', async () => {
  let created;
  const repository = {
    findNamesakes: async () => [],
    createReader: async (values, actorId, issuedOn) => {
      created = { values, actorId, issuedOn };
      return { status: 'created', readerId: '10' };
    },
    findById: async () => reader(),
  };
  const service = new ReaderService(repository, {
    now: () => new Date('2026-11-02T10:00:00Z'),
  });

  const result = await service.createReader(
    {
      fullName: '  Іваненко  Іван Іванович ',
      category: 'student',
      classId: '3',
      phone: '+380501234567',
      address: '',
      ticketType: 'existing',
      ticketNumber: ' T-10 ',
      ticketExpiresOn: '2027-06-30',
    },
    librarian,
  );

  assert.equal(created.values.fullName, 'Іваненко Іван Іванович');
  assert.equal(created.values.ticketNumber, 'T-10');
  assert.equal(created.actorId, '2');
  assert.equal(created.issuedOn, '2026-11-02');
  assert.equal(result.id, '10');
});

test('employee cannot have a class or ticket expiration date', async () => {
  const service = new ReaderService({});

  await assert.rejects(
    service.createReader(
      {
        fullName: 'Працівник Ліцею',
        category: 'employee',
        classId: '3',
        phone: '+380501234567',
        ticketType: 'existing',
        ticketNumber: 'EMP-1',
        ticketExpiresOn: '2027-06-30',
      },
      librarian,
    ),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      Boolean(error.details.fields.classId) &&
      Boolean(error.details.fields.ticketExpiresOn),
  );
});

test('reader creation requires confirmation when a namesake exists', async () => {
  const match = { id: '8', fullName: 'Іваненко Іван', ticketNumber: 'T-8' };
  const service = new ReaderService({
    findNamesakes: async () => [match],
    createReader: async () => assert.fail('reader must not be created'),
  });

  await assert.rejects(
    service.createReader(
      {
        fullName: 'Іваненко Іван',
        category: 'employee',
        phone: '+380501234567',
        ticketType: 'existing',
        ticketNumber: 'T-9',
      },
      librarian,
    ),
    (error) =>
      error.code === 'NAMESAKE_WARNING' && error.details.matches[0].ticketNumber === 'T-8',
  );
});

test('electronic ticket is accepted only for a student without a supplied number', async () => {
  const service = new ReaderService({});

  await assert.rejects(
    service.createReader(
      {
        fullName: 'Працівник Ліцею',
        category: 'employee',
        phone: '+380501234567',
        ticketType: 'electronic',
      },
      librarian,
    ),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.ticketType),
  );
});

test('librarian cannot change a ticket number', async () => {
  const service = new ReaderService({ findById: async () => reader() });

  await assert.rejects(
    service.updateReader(
      '10',
      { ticketNumber: 'T-11', confirmTicketNumberChange: true, reason: 'Виправлення' },
      librarian,
    ),
    (error) => error.code === 'ACCESS_DENIED' && error.status === 403,
  );
});

test('manager must confirm a ticket number change and provide a reason', async () => {
  const service = new ReaderService({ findById: async () => reader() });

  await assert.rejects(
    service.updateReader('10', { ticketNumber: 'T-11' }, manager),
    (error) => error.code === 'TICKET_NUMBER_CHANGE_CONFIRMATION_REQUIRED',
  );

  await assert.rejects(
    service.updateReader(
      '10',
      { ticketNumber: 'T-11', confirmTicketNumberChange: true },
      manager,
    ),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.reason),
  );
});

test('ordinary reader fields can be updated by a librarian', async () => {
  let updated;
  const repository = {
    findById: async () => reader({ phone: '+380501111111' }),
    updateReader: async (readerId, values, context) => {
      updated = { readerId, values, context };
      return { status: 'updated' };
    },
  };
  const service = new ReaderService(repository);

  await service.updateReader('10', { phone: '+380502222222' }, librarian);

  assert.equal(updated.values.phone, '+380502222222');
  assert.equal(updated.context.actorId, '2');
});

test('student ticket expiration can be extended while the card is archived', async () => {
  let updated;
  const repository = {
    findById: async () => reader({ isArchived: true }),
    updateReader: async (readerId, values) => {
      updated = { readerId, values };
      return { status: 'updated' };
    },
  };
  const service = new ReaderService(repository);

  await service.updateReader('10', { ticketExpiresOn: '2028-06-30' }, librarian);

  assert.equal(updated.values.ticketExpiresOn, '2028-06-30');
});

test('reader can be archived when the repository confirms there are no open loans', async () => {
  let received;
  const repository = {
    archiveReader: async (readerId, context) => {
      received = { readerId, context };
      return { status: 'archived', readerId };
    },
    findById: async () => reader({ isArchived: true, archiveReason: 'За зверненням' }),
  };
  const service = new ReaderService(repository);

  const result = await service.archiveReader(
    '10',
    { version: '1', reason: ' За зверненням ' },
    librarian,
    'archive-reader-10',
  );

  assert.deepEqual(received, {
    readerId: '10',
    context: {
      version: '1',
      reason: 'За зверненням',
      actorId: '2',
      requestKey: 'archive-reader-10',
    },
  });
  assert.equal(result.isArchived, true);
});

test('reader with an open loan cannot be archived', async () => {
  const service = new ReaderService({
    archiveReader: async () => ({ status: 'open_loans' }),
  });

  await assert.rejects(
    service.archiveReader(
      '10',
      { version: '1', reason: 'За зверненням' },
      librarian,
      'archive-reader-open-loan',
    ),
    (error) => error.code === 'READER_HAS_OPEN_LOANS' && error.status === 422,
  );
});

test('expired student card cannot be restored', async () => {
  const service = new ReaderService({
    restoreReader: async () => ({ status: 'ticket_expired' }),
  });

  await assert.rejects(
    service.restoreReader('10', { version: '2' }, manager, 'restore-expired-reader'),
    (error) => error.code === 'READER_TICKET_EXPIRED' && error.status === 422,
  );
});
