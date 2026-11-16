const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * Запускає початкову й періодичну перевірку читачів, придатних до знеособлення.
 *
 * @param {object} readerService Сервіс читачів.
 * @param {Console} [logger=console] Logger службових помилок.
 * @param {object} [options] Налаштування планувальника.
 * @param {number} [options.intervalMilliseconds=86400000] Інтервал, типово одна доба.
 * @param {Function} [options.schedule=setInterval] Функція планування для тестів.
 * @returns {{run: Function, stop: Function}} Керування job.
 */
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
