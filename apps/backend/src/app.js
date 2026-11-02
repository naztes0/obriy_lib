import { randomUUID } from 'node:crypto';
import { AppError } from './http/app-error.js';
import { sendError } from './http/response.js';
import { Router } from './http/router.js';
import { AuthRepository } from './modules/auth/auth-repository.js';
import { registerAuthRoutes } from './modules/auth/auth-routes.js';
import { AuthService } from './modules/auth/auth-service.js';
import { CatalogRepository } from './modules/catalog/catalog-repository.js';
import { registerCatalogRoutes } from './modules/catalog/catalog-routes.js';
import { CatalogService } from './modules/catalog/catalog-service.js';
import { CopyRepository } from './modules/copies/copy-repository.js';
import { registerCopyRoutes } from './modules/copies/copy-routes.js';
import { CopyService } from './modules/copies/copy-service.js';
import { registerHealthRoutes } from './modules/health/health-routes.js';
import { SchoolClassRepository } from './modules/school-classes/school-class-repository.js';
import { registerSchoolClassRoutes } from './modules/school-classes/school-class-routes.js';
import { SchoolClassService } from './modules/school-classes/school-class-service.js';

export function createApp({ pool, config = {}, logger = console, services = {} }) {
  const effectiveConfig = {
    sessionTtlMilliseconds: 8 * 60 * 60 * 1000,
    cookieSecure: false,
    ...config,
  };
  const authService =
    services.authService ??
    new AuthService(new AuthRepository(pool), {
      sessionTtlMilliseconds: effectiveConfig.sessionTtlMilliseconds,
    });
  const catalogService = services.catalogService ?? new CatalogService(new CatalogRepository(pool));
  const copyService = services.copyService ?? new CopyService(new CopyRepository(pool));
  const schoolClassService =
    services.schoolClassService ?? new SchoolClassService(new SchoolClassRepository(pool));

  const router = new Router();
  registerHealthRoutes(router, { pool, logger });
  registerAuthRoutes(router, {
    authService,
    sessionTtlMilliseconds: effectiveConfig.sessionTtlMilliseconds,
    cookieSecure: effectiveConfig.cookieSecure,
  });
  registerCatalogRoutes(router, { authService, catalogService });
  registerCopyRoutes(router, { authService, copyService });
  registerSchoolClassRoutes(router, { authService, schoolClassService });

  return async function handleRequest(request, response) {
    const requestId = randomUUID();

    try {
      await router.handle(request, response, { requestId });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      if (error instanceof AppError) {
        sendError(response, error, requestId);
        return;
      }

      logger.error(`[${requestId}] Unexpected request failure:`, error);
      sendError(
        response,
        new AppError(500, 'INTERNAL_ERROR', 'Сталася внутрішня помилка сервера.'),
        requestId,
      );
    }
  };
}
