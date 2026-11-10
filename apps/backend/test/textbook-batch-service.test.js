import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextbookBatchService } from '../src/modules/textbook-batches/textbook-batch-service.js';

const actor = { id: '2', role: 'librarian' };
const input = {
  classId: '3',
  dueDate: '2027-05-31',
  items: [
    { readerId: '10', copyId: '20' },
    { readerId: '11', copyId: '21' },
  ],
};

function preview(overrides = {}) {
  return {
    schoolClass: { id: '3', name: '10-А' },
    issueDate: '2026-11-10',
    dueDate: '2027-05-31',
    totalItems: 2,
    validItems: 2,
    invalidItems: 0,
    canConfirm: true,
    items: [],
    ...overrides,
  };
}

test('textbook batch preview passes normalized input and Kyiv date', async () => {
  let received;
  const service = new TextbookBatchService(
    {
      previewBatch: async (values) => {
        received = values;
        return { status: 'ok', preview: preview() };
      },
    },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  const result = await service.previewBatch(input);

  assert.deepEqual(received, { ...input, issueDate: '2026-11-10' });
  assert.equal(result.canConfirm, true);
});

test('textbook batch rejects more than 500 rows before querying', async () => {
  const service = new TextbookBatchService({
    previewBatch: async () => assert.fail('repository must not be called'),
  });
  const items = Array.from({ length: 501 }, (_, index) => ({
    readerId: String(index + 1),
    copyId: String(index + 1),
  }));

  await assert.rejects(
    service.previewBatch({ classId: '3', dueDate: '2027-05-31', items }),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.items),
  );
});

test('textbook batch confirmation returns all row errors without creating loans', async () => {
  const invalidPreview = preview({
    validItems: 1,
    invalidItems: 1,
    canConfirm: false,
    items: [
      { index: 0, isValid: true, errors: [] },
      {
        index: 1,
        isValid: false,
        errors: [
          { code: 'reader_blocked', message: 'Учень має активне блокування.' },
          { code: 'copy_on_loan', message: 'Примірник уже має незавершену видачу.' },
        ],
      },
    ],
  });
  const service = new TextbookBatchService(
    {
      findBatchIdByRequest: async () => null,
      createBatch: async () => ({ status: 'validation_failed', preview: invalidPreview }),
    },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  await assert.rejects(
    service.createBatch(input, actor, 'batch-request-1'),
    (error) =>
      error.code === 'BATCH_VALIDATION_FAILED' &&
      error.status === 422 &&
      error.details.items[1].errors.length === 2,
  );
});

test('textbook batch confirmation returns the created batch', async () => {
  let received;
  const repository = {
    findBatchIdByRequest: async () => null,
    createBatch: async (values, context) => {
      received = { values, context };
      return { status: 'created', batchId: '5' };
    },
    findBatchById: async () => ({ id: '5', issueCount: 2, loans: [] }),
  };
  const service = new TextbookBatchService(repository, {
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  });

  const result = await service.createBatch(input, actor, 'batch-request-2');

  assert.deepEqual(received, {
    values: { ...input, issueDate: '2026-11-10' },
    context: { actorId: '2', requestKey: 'batch-request-2' },
  });
  assert.equal(result.id, '5');
  assert.equal(result.wasRepeated, false);
});

test('repeated textbook batch confirmation returns the original batch', async () => {
  const repository = {
    findBatchIdByRequest: async () => '5',
    createBatch: async () => assert.fail('repository must not create a repeated batch'),
    findBatchById: async () => ({ id: '5', issueCount: 2, loans: [] }),
  };
  const service = new TextbookBatchService(repository, {
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  });

  const result = await service.createBatch(input, actor, 'batch-request-2');

  assert.equal(result.id, '5');
  assert.equal(result.wasRepeated, true);
});
