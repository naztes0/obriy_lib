import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './database.js';
import { startReaderAnonymizationJob } from './jobs/reader-anonymization-job.js';
import { ReaderRepository } from './modules/readers/reader-repository.js';
import { ReaderService } from './modules/readers/reader-service.js';

const config = loadConfig();
const pool = createPool();
const readerService = new ReaderService(new ReaderRepository(pool));
await readerService.anonymizeEligibleReaders();
const anonymizationJob = startReaderAnonymizationJob(readerService);
const server = createServer(createApp({ pool, config, services: { readerService } }));

server.listen(config.port, config.host, () => {
  console.log(`Backend listening on http://${config.host}:${config.port}`);
});

let isShuttingDown = false;
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  anonymizationJob.stop();

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
  } catch (error) {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
