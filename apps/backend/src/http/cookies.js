export function parseCookies(request) {
  const header = request.headers.cookie;
  if (!header) return {};

  return Object.fromEntries(
    header.split(';').map((item) => {
      const separator = item.indexOf('=');
      if (separator < 0) return [item.trim(), ''];
      const rawValue = item.slice(separator + 1).trim();
      try {
        return [item.slice(0, separator).trim(), decodeURIComponent(rawValue)];
      } catch {
        return [item.slice(0, separator).trim(), rawValue];
      }
    }),
  );
}

export function createSessionCookie(token, { maxAgeSeconds, secure }) {
  const parts = [
    `obriy_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure }) {
  return createSessionCookie('', { maxAgeSeconds: 0, secure });
}
