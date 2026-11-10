import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestrictionService } from '../src/modules/restrictions/restriction-service.js';

const librarian = { id: '2', role: 'librarian' };
const manager = { id: '1', role: 'manager' };

function block(overrides = {}) {
  return {
    id: '7',
    readerId: '4',
    status: 'active',
    reasonCode: 'overdue',
    minimumUntil: '2026-12-10',
    isIndefinite: false,
    version: '1',
    unblockRequests: [],
    ...overrides,
  };
}

test('block confirmation passes the ground, actor and Kyiv date', async () => {
  let received;
  const repository = {
    confirmBlock: async (readerId, context) => {
      received = { readerId, context };
      return { status: 'created', blockId: '7' };
    },
    findBlockById: async () => block(),
  };
  const service = new RestrictionService(repository, {
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  });

  const result = await service.confirmBlock(
    '4',
    { sourceLoanId: '20', reasonCode: 'overdue' },
    librarian,
    'block-reader-4',
  );

  assert.deepEqual(received, {
    readerId: '4',
    context: {
      sourceLoanId: '20',
      reasonCode: 'overdue',
      today: '2026-11-10',
      actorId: '2',
      requestKey: 'block-reader-4',
    },
  });
  assert.equal(result.status, 'active');
});

test('block confirmation rejects a ground whose period has not elapsed', async () => {
  const service = new RestrictionService({
    confirmBlock: async () => ({ status: 'ground_not_reached' }),
  });

  await assert.rejects(
    service.confirmBlock(
      '4',
      { sourceLoanId: '20', reasonCode: 'unresolved_loss' },
      librarian,
      'early-loss-block',
    ),
    (error) => error.code === 'BLOCK_GROUND_NOT_REACHED' && error.status === 422,
  );
});

test('librarian unblock request is returned as part of the block', async () => {
  let received;
  const repository = {
    createUnblockRequest: async (blockId, context) => {
      received = { blockId, context };
      return { status: 'created', blockId, requestId: '9' };
    },
    findBlockById: async () =>
      block({ unblockRequests: [{ id: '9', decision: 'pending', version: '1' }] }),
  };
  const service = new RestrictionService(repository);

  const result = await service.createUnblockRequest(
    '7',
    { comment: 'Підстави усунено' },
    librarian,
    'unblock-request-7',
  );

  assert.equal(received.context.actorId, '2');
  assert.equal(received.context.comment, 'Підстави усунено');
  assert.equal(result.unblockRequests[0].decision, 'pending');
});

test('manager cannot unblock before the minimum period ends', async () => {
  const service = new RestrictionService({
    unblockDirectly: async () => ({ status: 'minimum_period' }),
  });

  await assert.rejects(
    service.unblockDirectly(
      '7',
      { version: '1', comment: null },
      manager,
      'early-unblock-7',
    ),
    (error) => error.code === 'BLOCK_MINIMUM_PERIOD_NOT_ENDED' && error.status === 422,
  );
});

test('manager decision passes request version and decision', async () => {
  let received;
  const repository = {
    decideUnblockRequest: async (requestId, context) => {
      received = { requestId, context };
      return { status: 'rejected', blockId: '7' };
    },
    findBlockById: async () => block(),
  };
  const service = new RestrictionService(repository, {
    now: () => new Date('2026-12-11T10:00:00.000Z'),
  });

  await service.decideUnblockRequest(
    '9',
    { version: '1', decision: 'rejected', comment: 'Підстава ще існує' },
    manager,
    'reject-unblock-9',
  );

  assert.equal(received.context.today, '2026-12-11');
  assert.equal(received.context.decision, 'rejected');
  assert.equal(received.context.actorId, '1');
});

test('manager can annul an erroneous block with a reason', async () => {
  let received;
  const repository = {
    annulBlock: async (blockId, context) => {
      received = { blockId, context };
      return { status: 'annulled', blockId };
    },
    findBlockById: async () => block({ status: 'annulled', version: '2' }),
  };
  const service = new RestrictionService(repository);

  const result = await service.annulBlock(
    '7',
    { version: '1', reason: 'Помилково вибрано видачу' },
    manager,
    'annul-block-7',
  );

  assert.equal(received.context.reason, 'Помилково вибрано видачу');
  assert.equal(result.status, 'annulled');
});
