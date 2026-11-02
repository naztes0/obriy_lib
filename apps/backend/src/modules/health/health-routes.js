import { AppError } from '../../http/app-error.js';
import { sendData } from '../../http/response.js';
import { HealthService } from './health-service.js';

export function registerHealthRoutes(router, { pool, logger }) {
  const healthService = new HealthService(pool);

  router.get('/health', async ({ response, requestId }) => {
    try {
      const status = await healthService.check();
      sendData(response, 200, status, requestId);
    } catch (error) {
      logger.error(`[${requestId}] Database health check failed:`, error.message);
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Сервіс тимчасово недоступний.');
    }
  });
}
