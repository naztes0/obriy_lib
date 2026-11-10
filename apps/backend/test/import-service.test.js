import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImportPackageError } from '../src/modules/imports/import-package.js';
import { ImportService } from '../src/modules/imports/import-service.js';

const importPackage = {
  contentHash: 'a'.repeat(64),
  recordCounts: { 'books.csv': 1 },
  data: {},
};

test('validation reports a package that is ready for import', async () => {
  let received;
  const service = new ImportService(
    {
      inspectPackage: async (sourceName, value) => {
        received = { sourceName, value };
        return { status: 'ready' };
      },
    },
    { packageLoader: async () => importPackage },
  );

  const result = await service.validate({ sourceName: 'obriy-legacy', directory: 'data' });

  assert.equal(received.sourceName, 'obriy-legacy');
  assert.equal(received.value, importPackage);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.recordCounts, { 'books.csv': 1 });
});

test('database conflicts are returned as package validation errors', async () => {
  const errors = [{ file: 'books.csv', row: 2, field: 'isbn', message: 'Duplicate' }];
  const service = new ImportService(
    { inspectPackage: async () => ({ status: 'conflict', errors }) },
    { packageLoader: async () => importPackage },
  );

  await assert.rejects(
    service.validate({ sourceName: 'obriy-legacy', directory: 'data' }),
    (error) => error instanceof ImportPackageError && error.errors === errors,
  );
});

test('import passes normalized operator and returns repeat-safe result', async () => {
  let received;
  const service = new ImportService(
    {
      importPackage: async (sourceName, operatorName, value) => {
        received = { sourceName, operatorName, value };
        return { status: 'repeated', batchId: '5', recordCounts: value.recordCounts };
      },
    },
    { packageLoader: async () => importPackage },
  );

  const result = await service.import({
    sourceName: 'obriy-legacy',
    directory: 'data',
    operatorName: '  Назар   Тесленко ',
  });

  assert.equal(received.operatorName, 'Назар Тесленко');
  assert.equal(result.status, 'repeated');
  assert.equal(result.batchId, '5');
});

test('invalid source and missing operator are rejected before database access', async () => {
  const service = new ImportService(
    {
      inspectPackage: async () => assert.fail('repository must not be called'),
      importPackage: async () => assert.fail('repository must not be called'),
    },
    { packageLoader: async () => importPackage },
  );

  await assert.rejects(
    service.validate({ sourceName: 'джерело', directory: 'data' }),
    (error) => error instanceof ImportPackageError && error.errors[0].field === 'source',
  );
  await assert.rejects(
    service.import({ sourceName: 'source', directory: 'data', operatorName: ' ' }),
    (error) => error instanceof ImportPackageError && error.errors[0].field === 'operator',
  );
});
