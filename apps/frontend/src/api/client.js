import { rememberRequest, forgetRequest } from './pending.js';

export const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get fields() {
    return this.details?.fields ?? {};
  }

  get isUnconfirmed() {
    return this.code === 'TIMEOUT' || this.code === 'NETWORK_ERROR' || this.code === 'UNCONFIRMED_RESPONSE' || this.status >= 500 || this.status === 401;
  }
}

export function newIdempotencyKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toQueryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export async function request(path, { method = 'GET', query, body, idempotencyKey, signal } = {}) {
  if (idempotencyKey) {
    try { rememberRequest({ path, method, body, key: idempotencyKey }); }
    catch (cause) { throw new ApiError({ status: 409, code: 'PENDING_OPERATION', message: cause.message }); }
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(`${path}${toQueryString(query)}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    if (timedOut) {
      throw new ApiError({
        status: 0,
        code: 'TIMEOUT',
        message:
          'Результат не підтверджено: сервер не відповів за 10 секунд. Оновіть дані та перевірте результат перед повторенням.',
      });
    }
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Не вдалося зв’язатися із сервером. Оновіть дані та перевірте результат перед повторенням.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = payload?.error;
    const apiError = new ApiError({
      status: response.status,
      code: error?.code ?? 'UNKNOWN_ERROR',
      message: error?.message ?? 'Сталася помилка. Спробуйте ще раз.',
      details: error?.details,
      requestId: error?.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
    });
    if (response.status === 401 && ['AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED'].includes(apiError.code)) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    if (idempotencyKey && !apiError.isUnconfirmed) forgetRequest(idempotencyKey);
    throw apiError;
  }

  if (idempotencyKey && (!payload || !Object.hasOwn(payload, 'data'))) throw new ApiError({ status: 0, code: 'UNCONFIRMED_RESPONSE', message: 'Сервер не повернув підтвердження. Перевірте незавершену операцію.' });
  if (idempotencyKey) forgetRequest(idempotencyKey);
  return { data: payload?.data, meta: payload?.meta };
}

const api = {
  get: (path, query, signal) => request(path, { query, signal }),
  post: (path, body, idempotencyKey) => request(path, { method: 'POST', body: body ?? {}, idempotencyKey }),
  patch: (path, body, idempotencyKey) => request(path, { method: 'PATCH', body, idempotencyKey }),
};

export default api;
