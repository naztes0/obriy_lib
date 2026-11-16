import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { ApiError, REQUEST_TIMEOUT_MS, request } from '../api/client.js';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('request', () => {
  it('надсилає cookie, JSON і Idempotency-Key, повертає data та meta', async () => {
    fetch.mockResolvedValue(jsonResponse(201, { data: { id: '1' }, meta: { page: 1 } }));
    const result = await api.post('/api/v1/loans', { copyId: '5' }, 'key-123');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/loans');
    expect(init.credentials).toBe('include');
    expect(init.headers['Idempotency-Key']).toBe('key-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ copyId: '5' });
    expect(result).toEqual({ data: { id: '1' }, meta: { page: 1 } });
  });

  it('формує query-рядок і пропускає порожні значення', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { data: [] }));
    await api.get('/api/v1/books', { title: 'алг', author: '', page: 2, x: undefined });
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/books?title=%D0%B0%D0%BB%D0%B3&page=2');
  });

  it('розбирає помилку сервера: код, повідомлення, поля, код звернення', async () => {
    fetch.mockResolvedValue(
      jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Перевірте дані.', requestId: 'r-1', details: { fields: { title: 'Вкажіть назву.' } } } }),
    );
    const error = await request('/api/v1/books', { method: 'POST', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.fields).toEqual({ title: 'Вкажіть назву.' });
    expect(error.requestId).toBe('r-1');
    expect(error.isUnconfirmed).toBe(false);
  });

  it('обрив мережі → NETWORK_ERROR з невідомим результатом', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await api.get('/api/v1/books').catch((e) => e);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.isUnconfirmed).toBe(true);
  });

  it('таймаут 10 с → TIMEOUT «результат не підтверджено»', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    const pending = api.get('/api/v1/books').catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const error = await pending;
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('не підтверджено');
    expect(error.isUnconfirmed).toBe(true);
  });

  it('401 із кодом сеансу сповіщає про завершення сеансу', async () => {
    const listener = vi.fn();
    window.addEventListener('auth:expired', listener);
    fetch.mockResolvedValue(jsonResponse(401, { error: { code: 'SESSION_EXPIRED', message: 'Сеанс завершився.' } }));
    await api.get('/api/v1/books').catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:expired', listener);
  });

  it('401 через неправильний поточний пароль НЕ виходить із системи', async () => {
    const listener = vi.fn();
    window.addEventListener('auth:expired', listener);
    fetch.mockResolvedValue(jsonResponse(401, { error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Поточний пароль неправильний.' } }));
    await api.patch('/api/v1/staff/me/password', {}).catch(() => {});
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('auth:expired', listener);
  });
});
