import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CopyService } from '../src/modules/copies/copy-service.js';

const actor = { id: '7', role: 'librarian' };

test('copy creation validates and passes normalized values with the actor', async () => {
  let received;
  const repository = {
    createCopy: async (input) => {
      received = input;
      return { status: 'created', copyId: '11' };
    },
    findCopyById: async () => ({ id: '11', condition: 'worn' }),
  };
  const service = new CopyService(repository);

  const result = await service.createCopy(
    '4',
    {
      inventoryNumber: ' AB-12/3 ',
      condition: 'worn',
      defectDescription: '  потерта   обкладинка ',
    },
    actor,
  );

  assert.deepEqual(received, {
    bookId: '4',
    inventoryNumber: 'AB-12/3',
    condition: 'worn',
    defectDescription: 'потерта обкладинка',
    actorId: '7',
  });
  assert.equal(result.id, '11');
});

test('worn and damaged copies require a defect description', async () => {
  const service = new CopyService({});

  await assert.rejects(
    service.createCopy('1', { inventoryNumber: 'INV-1', condition: 'damaged' }, actor),
    (error) =>
      error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.defectDescription),
  );
});

test('copy creation maps a database uniqueness conflict', async () => {
  const service = new CopyService({
    createCopy: async () => {
      const error = new Error('duplicate');
      error.code = '23505';
      error.constraint = 'book_copies_inventory_unique';
      throw error;
    },
  });

  await assert.rejects(
    service.createCopy('1', { inventoryNumber: 'INV-1', condition: 'good' }, actor),
    (error) => error.code === 'INVENTORY_NUMBER_EXISTS' && error.status === 409,
  );
});

test('condition change requires a reason and returns the current copy', async () => {
  let received;
  const service = new CopyService({
    changeCondition: async (copyId, input) => {
      received = { copyId, ...input };
      return { status: 'updated' };
    },
    findCopyById: async () => ({ id: '8', condition: 'damaged', isAvailable: false }),
  });

  const copy = await service.changeCondition(
    '8',
    { condition: 'damaged', defectDescription: 'Розірвано сторінки', reason: 'Огляд при поверненні' },
    actor,
  );

  assert.equal(received.actorId, '7');
  assert.equal(received.reason, 'Огляд при поверненні');
  assert.equal(copy.isAvailable, false);
});

test('temporary unavailability only accepts a boolean and a reason', async () => {
  const service = new CopyService({});

  await assert.rejects(
    service.setTemporaryUnavailability(
      '3',
      { isTemporarilyUnavailable: 'true', reason: '' },
      actor,
    ),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      Boolean(error.details.fields.isTemporarilyUnavailable) &&
      Boolean(error.details.fields.reason),
  );
});

test('copy can be marked lost in the fund without a loan', async () => {
  let received;
  const service = new CopyService({
    markLostInFund: async (copyId, input) => {
      received = { copyId, ...input };
      return { status: 'lost', copyId };
    },
    findCopyById: async () => ({ id: '3', isLost: true, isAvailable: false, version: '2' }),
  });

  const result = await service.markLostInFund(
    '3',
    { version: '1', reason: ' Не знайдено під час інвентаризації ' },
    actor,
    'fund-loss-3',
  );

  assert.deepEqual(received, {
    copyId: '3',
    version: '1',
    reason: 'Не знайдено під час інвентаризації',
    actorId: '7',
    requestKey: 'fund-loss-3',
  });
  assert.equal(result.isLost, true);
});

test('copy on loan cannot be marked lost through the fund flow', async () => {
  const service = new CopyService({
    markLostInFund: async () => ({ status: 'copy_on_loan' }),
  });

  await assert.rejects(
    service.markLostInFund(
      '3',
      { version: '1', reason: 'Не знайдено' },
      actor,
      'fund-loss-on-loan',
    ),
    (error) => error.code === 'COPY_HAS_OPEN_LOAN' && error.status === 422,
  );
});

test('copy history is paginated after checking that the copy exists', async () => {
  let query;
  const service = new CopyService({
    findCopyById: async () => ({ id: '5' }),
    listHistory: async (copyId, pagination) => {
      query = { copyId, ...pagination };
      return { events: [{ id: '9' }], totalItems: 26 };
    },
  });

  const result = await service.listHistory(
    '5',
    new URLSearchParams({ page: '2', pageSize: '25' }),
  );

  assert.deepEqual(query, { copyId: '5', page: 2, pageSize: 25, offset: 25 });
  assert.deepEqual(result.meta, {
    page: 2,
    pageSize: 25,
    totalItems: 26,
    totalPages: 2,
  });
});

test('librarian archives a copy after explicit confirmation', async () => {
  let received;
  const service = new CopyService({
    archiveCopy: async (copyId, input) => {
      received = { copyId, ...input };
      return { status: 'archived', copyId };
    },
    findCopyById: async () => ({ id: '5', isArchived: true, version: '3' }),
  });

  const result = await service.archiveCopy(
    '5',
    { version: '2', reason: ' Не використовується ', confirmArchive: true },
    actor,
    'archive-copy-5',
  );

  assert.deepEqual(received, {
    copyId: '5',
    version: '2',
    reason: 'Не використовується',
    actorId: '7',
    requestKey: 'archive-copy-5',
  });
  assert.equal(result.isArchived, true);
});

test('copy cannot be restored while its book is archived', async () => {
  const service = new CopyService({ restoreCopy: async () => ({ status: 'book_archived' }) });

  await assert.rejects(
    service.restoreCopy(
      '5',
      { version: '2', confirmRestore: true },
      { id: '1', role: 'manager' },
      'restore-copy-5',
    ),
    (error) => error.code === 'BOOK_ARCHIVED' && error.status === 422,
  );
});

test('inventory number correction requires confirmation and records the reason', async () => {
  let received;
  const service = new CopyService({
    correctInventoryNumber: async (copyId, input) => {
      received = { copyId, ...input };
      return { status: 'corrected', copyId };
    },
    findCopyById: async () => ({ id: '5', inventoryNumber: 'INV-NEW', version: '4' }),
  });

  const result = await service.correctInventoryNumber(
    '5',
    {
      version: '3',
      inventoryNumber: ' INV-NEW ',
      reason: ' Помилка маркування ',
      confirmNumberChange: true,
    },
    { id: '1', role: 'manager' },
    'correct-copy-number-5',
  );

  assert.equal(received.inventoryNumber, 'INV-NEW');
  assert.equal(received.reason, 'Помилка маркування');
  assert.equal(result.inventoryNumber, 'INV-NEW');
});

test('unused copy deletion rejects any loan history', async () => {
  const service = new CopyService({ deleteUnusedCopy: async () => ({ status: 'has_loans' }) });

  await assert.rejects(
    service.deleteUnusedCopy(
      '5',
      { version: '2', confirmDelete: true },
      { id: '1', role: 'manager' },
      'delete-copy-5',
    ),
    (error) => error.code === 'COPY_HAS_LOAN_HISTORY' && error.status === 422,
  );
});

test('final write-off reports that copy history and report rows were deleted', async () => {
  const service = new CopyService({
    writeOffCopy: async (copyId) => ({ status: 'written_off', copyId }),
  });

  const result = await service.writeOffCopy(
    '5',
    { version: '4', reason: 'Фізичне списання', confirmReportImpact: true },
    { id: '1', role: 'manager' },
    'write-off-copy-5',
  );

  assert.deepEqual(result, {
    id: '5',
    writtenOff: true,
    historyDeleted: true,
    reportsChanged: true,
  });
});
