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

test('loan issue rejects an employee whose employment has ended', async () => {
  const service = new LoanService(
    { issueLoan: async () => ({ status: 'employment_ended' }) },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  await assert.rejects(
    service.issueLoan({ readerId: '1', copyId: '2' }, actor, 'request-ended-employee'),
    (error) => error.code === 'READER_EMPLOYMENT_ENDED' && error.status === 422,
  );
});

test('loan issue rejects a blocked reader', async () => {
  const service = new LoanService(
    { issueLoan: async () => ({ status: 'reader_blocked' }) },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  await assert.rejects(
    service.issueLoan({ readerId: '1', copyId: '2' }, actor, 'request-blocked-reader'),
    (error) => error.code === 'READER_BLOCKED' && error.status === 422,
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
  let checkedReaderId;
  const repository = {
    returnLoan: async (loanId, input) => {
      received = { loanId, ...input };
      return { status: 'returned', loanId };
    },
    findById: async () => ({
      id: '20',
      status: 'returned',
      returnCondition: 'worn',
      reader: { id: '4' },
    }),
  };
  const service = new LoanService(repository, {
    afterObligationClosed: async (readerId) => {
      checkedReaderId = readerId;
    },
  });

  const result = await service.returnLoan(
    '20',
    { version: '1', condition: 'worn', defectDescription: 'Потерта обкладинка' },
    actor,
    'return-request-1',
  );

  assert.deepEqual(received, {
    loanId: '20',
    version: '1',
    condition: 'worn',
    defectDescription: 'Потерта обкладинка',
    actorId: '1',
    requestKey: 'return-request-1',
  });
  assert.equal(result.status, 'returned');
  assert.equal(checkedReaderId, '4');
});

test('damaged return requires a defect description', async () => {
  const service = new LoanService({});

  await assert.rejects(
    service.returnLoan('20', { version: '1', condition: 'damaged' }, actor, 'return-request-2'),
    (error) =>
      error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.defectDescription),
  );
});

test('loan extension passes the date, reason, version and current Kyiv date', async () => {
  let received;
  const repository = {
    extendLoan: async (loanId, input) => {
      received = { loanId, ...input };
      return { status: 'extended', loanId };
    },
    findById: async () => ({ id: '20', status: 'issued', currentDueDate: '2026-12-20' }),
  };
  const service = new LoanService(repository, {
    now: () => new Date('2026-11-03T10:00:00.000Z'),
  });

  await service.extendLoan(
    '20',
    { version: '1', newDueDate: '2026-12-20', reason: 'Потрібно для навчання' },
    actor,
    'extend-request-1',
  );

  assert.deepEqual(received, {
    loanId: '20',
    version: '1',
    newDueDate: '2026-12-20',
    reason: 'Потрібно для навчання',
    today: '2026-11-03',
    actorId: '1',
    requestKey: 'extend-request-1',
  });
});

test('loan extension rejects an employee whose employment has ended', async () => {
  const service = new LoanService(
    { extendLoan: async () => ({ status: 'employment_ended' }) },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  await assert.rejects(
    service.extendLoan(
      '20',
      { version: '1', newDueDate: '2026-11-20', reason: 'Потрібно для навчання' },
      actor,
      'extend-ended-employee',
    ),
    (error) => error.code === 'READER_EMPLOYMENT_ENDED' && error.status === 422,
  );
});

test('loan extension rejects a blocked reader', async () => {
  const service = new LoanService(
    { extendLoan: async () => ({ status: 'reader_blocked' }) },
    { now: () => new Date('2026-11-10T10:00:00.000Z') },
  );

  await assert.rejects(
    service.extendLoan(
      '20',
      { version: '1', newDueDate: '2026-11-20', reason: 'Потрібно для навчання' },
      actor,
      'extend-blocked-reader',
    ),
    (error) => error.code === 'READER_BLOCKED' && error.status === 422,
  );
});

test('loan loss passes the current version and comment', async () => {
  let received;
  const repository = {
    markLoanLost: async (loanId, input) => {
      received = { loanId, ...input };
      return { status: 'lost', loanId };
    },
    findById: async () => ({ id: '20', status: 'lost', version: '2' }),
  };
  const service = new LoanService(repository);

  const result = await service.markLoanLost(
    '20',
    { version: '1', comment: 'Читач повідомив про втрату' },
    actor,
    'loss-request-1',
  );

  assert.equal(received.version, '1');
  assert.equal(received.comment, 'Читач повідомив про втрату');
  assert.equal(result.status, 'lost');
});

test('compensation rejects a stale version', async () => {
  const service = new LoanService({
    compensateLoan: async () => ({ status: 'version_conflict' }),
  });

  await assert.rejects(
    service.compensateLoan(
      '20',
      { version: '1', comment: 'Відшкодовано' },
      actor,
      'compensate-request-1',
    ),
    (error) => error.code === 'VERSION_CONFLICT' && error.status === 409,
  );
});

test('compensation checks whether the reader can be anonymized', async () => {
  let checkedReaderId;
  const repository = {
    compensateLoan: async () => ({ status: 'compensated', loanId: '20' }),
    findById: async () => ({ id: '20', status: 'compensated', reader: { id: '4' } }),
  };
  const service = new LoanService(repository, {
    afterObligationClosed: async (readerId) => {
      checkedReaderId = readerId;
    },
  });

  await service.compensateLoan(
    '20',
    { version: '2', comment: 'Відшкодовано' },
    actor,
    'compensate-request-2',
  );

  assert.equal(checkedReaderId, '4');
});

test('found copy requires a reason and returns its new state', async () => {
  const repository = {
    markCopyFound: async () => ({ status: 'found', copyId: '8' }),
    findCopyById: async () => ({ id: '8', isLost: false, version: '4' }),
  };
  const service = new LoanService(repository);

  const result = await service.markCopyFound(
    '8',
    { version: '3', reason: 'Примірник знайдено у фонді' },
    actor,
    'found-request-1',
  );

  assert.equal(result.isLost, false);
  assert.equal(result.version, '4');
});
