import { parseCookies } from '../../http/cookies.js';
import { AppError } from '../../http/app-error.js';

export function requireAuthentication(authService, handler) {
  return async function authenticatedHandler(context) {
    const token = parseCookies(context.request).obriy_session;
    const actor = await authService.authenticateToken(token);
    return handler({ ...context, actor });
  };
}

export function requireRole(authService, roles, handler) {
  return requireAuthentication(authService, async (context) => {
    if (!roles.includes(context.actor.role)) {
      throw new AppError(403, 'ACCESS_DENIED', 'Недостатньо прав для цієї дії.');
    }
    return handler(context);
  });
}
