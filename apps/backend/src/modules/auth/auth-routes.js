import { clearSessionCookie, createSessionCookie, parseCookies } from '../../http/cookies.js';
import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication } from './auth-guard.js';

export function registerAuthRoutes(router, { authService, sessionTtlMilliseconds, cookieSecure }) {
  router.post('/api/v1/auth/login', async ({ request, response, requestId }) => {
    const credentials = await readJsonBody(request);
    const result = await authService.login(credentials);
    const cookie = createSessionCookie(result.token, {
      maxAgeSeconds: sessionTtlMilliseconds / 1000,
      secure: cookieSecure,
    });

    sendData(
      response,
      200,
      { staff: result.staff, expiresAt: result.expiresAt.toISOString() },
      requestId,
      undefined,
      { 'Set-Cookie': cookie },
    );
  });

  router.get(
    '/api/v1/auth/session',
    requireAuthentication(authService, async ({ actor, response, requestId }) => {
      sendData(response, 200, { staff: actor }, requestId);
    }),
  );

  router.post('/api/v1/auth/logout', async ({ request, response, requestId }) => {
    const token = parseCookies(request).obriy_session;
    await authService.logout(token);
    sendData(
      response,
      200,
      { loggedOut: true },
      requestId,
      undefined,
      { 'Set-Cookie': clearSessionCookie({ secure: cookieSecure }) },
    );
  });
}
