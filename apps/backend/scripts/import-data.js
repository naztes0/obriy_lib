import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPool } from '../src/database.js';
import { ImportPackageError } from '../src/modules/imports/import-package.js';
import { ImportRepository } from '../src/modules/imports/import-repository.js';
import { ImportService } from '../src/modules/imports/import-service.js';

function parseArguments(argumentsList) {
  const result = { validateOnly: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--validate-only') {
      result.validateOnly = true;
      continue;
    }
    if (['--source', '--dir', '--operator', '--report'].includes(argument)) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      result[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.source) throw new Error('Required argument: --source');
  if (!result.dir) throw new Error('Required argument: --dir');
  if (!result.validateOnly && !result.operator) throw new Error('Required argument: --operator');
  return result;
}

function buildReport({ ok, mode, sourceName, result, errors }) {
  return {
    ok,
    mode,
    sourceName,
    generatedAt: new Date().toISOString(),
    ...(result ? { result } : {}),
    ...(errors ? { errors } : {}),
  };
}

let argumentsValue;
try {
  argumentsValue = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

if (argumentsValue) {
  const directory = resolve(argumentsValue.dir);
  const reportPath = resolve(argumentsValue.report ?? join(directory, 'import-report.json'));
  const pool = createPool();
  const service = new ImportService(new ImportRepository(pool));
  const mode = argumentsValue.validateOnly ? 'validate' : 'import';

  try {
    const result = argumentsValue.validateOnly
      ? await service.validate({ sourceName: argumentsValue.source, directory })
      : await service.import({
          sourceName: argumentsValue.source,
          directory,
          operatorName: argumentsValue.operator,
        });
    const report = buildReport({
      ok: true,
      mode,
      sourceName: argumentsValue.source,
      result,
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${reportPath}`);
  } catch (error) {
    const errors =
      error instanceof ImportPackageError
        ? error.errors
        : [{ file: null, row: null, field: null, message: error.message }];
    const report = buildReport({
      ok: false,
      mode,
      sourceName: argumentsValue.source,
      errors,
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(JSON.stringify(report, null, 2));
    console.error(`Report: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
