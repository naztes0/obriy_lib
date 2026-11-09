const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function startReaderAnonymizationJob(
  readerService,
  { logger = console, intervalMilliseconds = DAY_IN_MILLISECONDS } = {},
) {
  let isRunning = false;

  async function run() {
    if (isRunning) return;
    isRunning = true;
    try {
      const result = await readerService.anonymizeEligibleReaders();
      if (result.count > 0) {
        logger.info?.(`Anonymized ${result.count} reader record(s).`);
      }
    } catch (error) {
      logger.error('Reader anonymization job failed:', error);
    } finally {
      isRunning = false;
    }
  }

  const timer = setInterval(run, intervalMilliseconds);
  timer.unref?.();

  return {
    run,
    stop() {
      clearInterval(timer);
    },
  };
}
