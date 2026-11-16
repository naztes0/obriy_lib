import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CorrectionService } from '../src/modules/loans/correction-service.js';

test('correction service validates and normalizes a correction command', async () => {
  let received;
  const repository = {
    execute: async (operation, entityId, context) => {
      received = { operation, entityId, context };
      return { id: entityId, corrected: true };
    },
  };
  const service = new CorrectionService(repository);

  const result = await service.execute(
    'correct_participants',
    '12',
    {
      version: 3,
      reason: '  Помилково вибрано читача  ',
      readerId: 8,
      confirm: true,
    },
    { id: '1', role: 'manager' },
    ' correction-12 ',
  );

  assert.deepEqual(received, {
    operation: 'correct_participants',
    entityId: '12',
    context: {
      actorId: '1',
      requestKey: 'correction-12',
      version: '3',
      reason: 'Помилково вибрано читача',
      readerId: '8',
      copyId: null,
      confirmNoTransfer: false,
    },
  });
  assert.deepEqual(result, { id: '12', corrected: true });
});

test('correction service rejects malformed commands before database access', async () => {
  const repository = { execute: async () => assert.fail('repository must not be called') };
  const service = new CorrectionService(repository);
  const actor = { id: '1', role: 'manager' };
  const valid = { version: '2', reason: 'Виправлення', confirm: true };

  for (const [operation, entityId, input] of [
    ['unknown', '12', valid],
    ['void_loan', '0', valid],
    ['void_loan', '12', { ...valid, version: 'wrong' }],
    ['void_loan', '12', { ...valid, reason: ' ' }],
    ['void_loan', '12', { ...valid, confirm: false }],
    ['correct_participants', '12', { ...valid, readerId: 'wrong' }],
  ]) {
    await assert.rejects(
      service.execute(operation, entityId, input, actor, 'correction-key'),
      (error) => error.code === 'VALIDATION_ERROR' && error.status === 400,
    );
  }
});

test('correction service requires an idempotency key', async () => {
  const service = new CorrectionService({ execute: async () => assert.fail() });
  await assert.rejects(
    service.execute(
      'settle_fund_loss',
      '5',
      { version: '1', reason: 'Врегулювання', confirm: true },
      { id: '1' },
      undefined,
    ),
    (error) => error.code === 'INVALID_IDEMPOTENCY_KEY' && error.status === 400,
  );
});
