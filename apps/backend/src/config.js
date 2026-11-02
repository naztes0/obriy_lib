export function loadConfig(environment = process.env) {
  const port = Number(environment.PORT ?? 3000);
  const sessionTtlHours = Number(environment.SESSION_TTL_HOURS ?? 8);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  if (!Number.isFinite(sessionTtlHours) || sessionTtlHours <= 0 || sessionTtlHours > 168) {
    throw new Error('SESSION_TTL_HOURS must be greater than 0 and not exceed 168');
  }

  const cookieSecure = environment.COOKIE_SECURE === 'true';
  if (environment.COOKIE_SECURE && !['true', 'false'].includes(environment.COOKIE_SECURE)) {
    throw new Error('COOKIE_SECURE must be true or false');
  }

  return {
    host: environment.HOST?.trim() || '127.0.0.1',
    port,
    sessionTtlMilliseconds: sessionTtlHours * 60 * 60 * 1000,
    cookieSecure,
  };
}
