import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startReaderAnonymizationJob } from '../src/jobs/reader-anonymization-job.js';

test('reader anonymization job can be run manually', async () => {
  let runs = 0;
  const job = startReaderAnonymizationJob(
    {
      anonymizeEligibleReaders: async () => {
        runs += 1;
        return { count: 0, readers: [] };
      },
    },
    { intervalMilliseconds: 60_000 },
  );

  await job.run();
  job.stop();

  assert.equal(runs, 1);
});
