import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoanService } from '../src/modules/loans/loan-service.js';

const actor = { id: '1', role: 'manager' };

test('loan issue calculates the thirtieth calendar day and passes idempotency data', async () => {
  let received;
  const repository = {
    issueLoan: async (input) => {
      received = input;
      return { status: 'created', loanId: '20' };
    },
    findById: async () => ({ id: '20', status: 'issued' }),
  };
  const service = new LoanService(repository, {
    now: () => new Date('2026-11-03T10:00:00.000Z'),
  });

  const result = await service.issueLoan(
    { readerId: '4', copyId: '8' },
    actor,
    'issue-request-1',
  );

  assert.deepEqual(received, {
    readerId: '4',
    copyId: '8',
    dueDate: null,
    issueDate: '2026-11-03',
    defaultDueDate: '2026-12-03',
    actorId: '1',
    requestKey: 'issue-request-1',
  });
  assert.equal(result.status, 'issued');
});

test('loan issue requires an idempotency key', async () => {
  const service = new LoanService({});

  await assert.rejects(
    service.issueLoan({ readerId: '1', copyId: '2' }, actor, undefined),
    (error) => error.code === 'INVALID_IDEMPOTENCY_KEY' && error.status === 400,
  );
});

test('loan issue maps an unavailable copy to a business error', async () => {
  const service = new LoanService(
    { issueLoan: async () => ({ status: 'copy_temporarily_unavailable' }) },
    { now: () => new Date('2026-11-03T10:00:00.000Z') },
  );

  await assert.rejects(
    service.issueLoan({ readerId: '1', copyId: '2' }, actor, 'request-2'),
    (error) => error.code === 'COPY_TEMPORARILY_UNAVAILABLE' && error.status === 422,
  );
});

test('loan issue maps a concurrent duplicate to a conflict', async () => {
  const service = new LoanService(
    {
      issueLoan: async () => {
        const error = new Error('duplicate');
        error.code = '23505';
        error.constraint = 'loans_one_open_per_copy';
        throw error;
      },
    },
    { now: () => new Date('2026-11-03T10:00:00.000Z') },
  );

  await assert.rejects(
    service.issueLoan({ readerId: '1', copyId: '2' }, actor, 'request-3'),
    (error) => error.code === 'COPY_ALREADY_ON_LOAN' && error.status === 409,
  );
});

test('loan return validates and passes the physical condition', async () => {
  let received;
  const repository = {
    returnLoan: async (loanId, input) => {
      received = { loanId, ...input };
      return { status: 'returned', loanId };
    },
    findById: async () => ({ id: '20', status: 'returned', returnCondition: 'worn' }),
  };
  const service = new LoanService(repository);

  const result = await service.returnLoan(
    '20',
    { condition: 'worn', defectDescription: 'Потерта обкладинка' },
    actor,
    'return-request-1',
  );

  assert.deepEqual(received, {
    loanId: '20',
    condition: 'worn',
    defectDescription: 'Потерта обкладинка',
    actorId: '1',
    requestKey: 'return-request-1',
  });
  assert.equal(result.status, 'returned');
});

test('damaged return requires a defect description', async () => {
  const service = new LoanService({});

  await assert.rejects(
    service.returnLoan('20', { condition: 'damaged' }, actor, 'return-request-2'),
    (error) =>
      error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.defectDescription),
  );
});
