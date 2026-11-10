import { ImportPackageError, loadImportPackage } from './import-package.js';

function validateSourceName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new ImportPackageError([
      {
        file: null,
        row: null,
        field: 'source',
        message: 'Джерело: 1–128 латинських літер, цифр, крапок, дефісів або підкреслень.',
      },
    ]);
  }
  return value;
}

function validateOperatorName(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  if (!normalized || normalized.length > 200) {
    throw new ImportPackageError([
      {
        file: null,
        row: null,
        field: 'operator',
        message: 'Вкажіть ім’я технічного виконавця до 200 символів.',
      },
    ]);
  }
  return normalized;
}

function throwConflicts(result) {
  if (result.status === 'conflict') throw new ImportPackageError(result.errors);
}

export class ImportService {
  constructor(repository, { packageLoader = loadImportPackage } = {}) {
    this.repository = repository;
    this.packageLoader = packageLoader;
  }

  async validate({ sourceName, directory }) {
    const source = validateSourceName(sourceName);
    const importPackage = await this.packageLoader(directory);
    const inspection = await this.repository.inspectPackage(source, importPackage);
    throwConflicts(inspection);
    return {
      status: inspection.status,
      sourceName: source,
      contentHash: importPackage.contentHash,
      recordCounts: inspection.recordCounts ?? importPackage.recordCounts,
      batchId: inspection.batchId ?? null,
    };
  }

  async import({ sourceName, directory, operatorName }) {
    const source = validateSourceName(sourceName);
    const operator = validateOperatorName(operatorName);
    const importPackage = await this.packageLoader(directory);
    const result = await this.repository.importPackage(source, operator, importPackage);
    throwConflicts(result);
    return {
      ...result,
      sourceName: source,
      contentHash: importPackage.contentHash,
    };
  }
}
