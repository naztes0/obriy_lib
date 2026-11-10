import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  ImportPackageError,
  importFileDefinitions,
  loadImportPackage,
} from '../src/modules/imports/import-package.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function csv(headers, rows) {
  return [headers, ...rows].map((row) => row.join(';')).join('\n') + '\n';
}

async function createPackage(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'obriy-import-'));
  temporaryDirectories.push(directory);
  const definitions = Object.fromEntries(importFileDefinitions.map((value) => [value.name, value]));
  const files = {
    'books.csv': csv(definitions['books.csv'].headers, [
      ['BOOK-1', 'Кобзар', 'Тарас Шевченко', 'Дніпро', '1985', '978-0-306-40615-7', 'false', ''],
    ]),
    'copies.csv': csv(definitions['copies.csv'].headers, [
      ['COPY-1', 'BOOK-1', 'INV-1', 'good', '', 'false', 'false', ''],
    ]),
    'readers.csv': csv(definitions['readers.csv'].headers, [
      [
        'READER-1', 'Працівник Ліцею', 'employee', '', '+380501112233', '',
        'EMP-1', 'existing', '', '', '', '', '',
      ],
    ]),
    'loans.csv': csv(definitions['loans.csv'].headers, [
      [
        'LOAN-1', 'READER-1', 'COPY-1', '2026-11-01T10:00:00+02:00',
        '2026-12-01', '2026-12-01', 'issued', '', '', 'Бібліотекар',
        'good', '', '', '', 'employee', '',
      ],
    ]),
    ...overrides,
  };
  await Promise.all(
    Object.entries(files).map(([name, content]) => writeFile(join(directory, name), content, 'utf8')),
  );
  return directory;
}

test('valid required CSV files are normalized and hashed', async () => {
  const directory = await createPackage();

  const result = await loadImportPackage(directory, {
    now: new Date('2026-11-10T12:00:00Z'),
  });

  assert.match(result.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(result.recordCounts['books.csv'], 1);
  assert.equal(result.recordCounts['loan_events.csv'], 0);
  assert.equal(result.data.books[0].is_textbook, false);
  assert.deepEqual(result.data.books[0].authors, ['Тарас Шевченко']);
  assert.equal(result.data.loans[0].status, 'issued');
});

test('package validation returns all format and relationship errors together', async () => {
  const definitions = Object.fromEntries(importFileDefinitions.map((value) => [value.name, value]));
  const directory = await createPackage({
    'books.csv': csv(definitions['books.csv'].headers, [
      ['BOOK-1', 'Кобзар', 'Тарас Шевченко', 'Дніпро', '1985', '978-0-306-40615-8', 'false', ''],
    ]),
    'copies.csv': csv(definitions['copies.csv'].headers, [
      ['COPY-1', 'MISSING-BOOK', 'INV-1', 'good', '', 'false', 'false', ''],
    ]),
    'readers.csv': csv(definitions['readers.csv'].headers, [
      ['READER-1', 'Учень', 'student', '', '0501112233', '', 'ST-1', 'existing', '', '', '', '', ''],
    ]),
    'loans.csv': csv(definitions['loans.csv'].headers, [
      [
        'LOAN-1', 'MISSING-READER', 'COPY-1', '2026-11-01T10:00:00+02:00',
        '2026-12-01', '2026-12-01', 'lost', '', '', 'Бібліотекар',
        'good', '', '', '', 'student', '',
      ],
    ]),
  });

  await assert.rejects(
    loadImportPackage(directory, { now: new Date('2026-11-10T12:00:00Z') }),
    (error) => {
      assert.ok(error instanceof ImportPackageError);
      assert.ok(error.errors.length >= 7);
      assert.ok(error.errors.some((item) => item.field === 'isbn'));
      assert.ok(error.errors.some((item) => item.field === 'book_source_id'));
      assert.ok(error.errors.some((item) => item.field === 'reader_source_id'));
      assert.ok(error.errors.some((item) => item.message.includes('історична подія')));
      return true;
    },
  );
});

test('missing required file and incorrect headers are reported', async () => {
  const directory = await createPackage({
    'books.csv': 'wrong;header\nvalue;value\n',
  });
  await rm(join(directory, 'copies.csv'));

  await assert.rejects(loadImportPackage(directory), (error) => {
    assert.ok(error.errors.some((item) => item.file === 'books.csv' && item.row === 1));
    assert.ok(
      error.errors.some(
        (item) => item.file === 'copies.csv' && item.message.includes('відсутній'),
      ),
    );
    return true;
  });
});
