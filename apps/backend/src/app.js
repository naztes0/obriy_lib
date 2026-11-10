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
import { LoanRepository } from './modules/loans/loan-repository.js';
import { registerLoanRoutes } from './modules/loans/loan-routes.js';
import { LoanService } from './modules/loans/loan-service.js';
import { ReaderRepository } from './modules/readers/reader-repository.js';
import { registerReaderRoutes } from './modules/readers/reader-routes.js';
import { ReaderService } from './modules/readers/reader-service.js';
import { RestrictionRepository } from './modules/restrictions/restriction-repository.js';
import { registerRestrictionRoutes } from './modules/restrictions/restriction-routes.js';
import { RestrictionService } from './modules/restrictions/restriction-service.js';
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
  const readerService = services.readerService ?? new ReaderService(new ReaderRepository(pool));
  const restrictionService =
    services.restrictionService ?? new RestrictionService(new RestrictionRepository(pool));
  const loanService =
    services.loanService ??
    new LoanService(new LoanRepository(pool), {
      afterObligationClosed: (readerId) => readerService.anonymizeReaderIfEligible(readerId),
    });

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
  registerReaderRoutes(router, { authService, readerService });
  registerRestrictionRoutes(router, { authService, restrictionService });
  registerLoanRoutes(router, { authService, loanService });

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
