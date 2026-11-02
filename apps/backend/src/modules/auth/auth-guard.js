import { parseCookies } from '../../http/cookies.js';

export function requireAuthentication(authService, handler) {
  return async function authenticatedHandler(context) {
    const token = parseCookies(context.request).obriy_session;
    const actor = await authService.authenticateToken(token);
    return handler({ ...context, actor });
  };
}
