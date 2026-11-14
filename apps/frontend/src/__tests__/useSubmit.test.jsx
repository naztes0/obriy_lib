import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';

const unconfirmed = () => new ApiError({ status: 0, code: 'TIMEOUT', message: 'не підтверджено' });
const rejected = () => new ApiError({ status: 409, code: 'COPY_NOT_AVAILABLE', message: 'Недоступний.' });

describe('useSubmit (Ф-01: ідемпотентність, блокування повторного натискання)', () => {
  it('після таймауту повторна спроба використовує той самий Idempotency-Key', async () => {
    const keys = [];
    const action = vi.fn(async (key) => { keys.push(key); if (keys.length === 1) throw unconfirmed(); return { data: 1 }; });
    const { result } = renderHook(() => useSubmit(action));
    await act(() => result.current.submit());
    expect(result.current.error.code).toBe('TIMEOUT');
    await act(() => result.current.submit());
    expect(keys[0]).toBe(keys[1]);
  });

  it('після остаточної відмови сервера ключ оновлюється', async () => {
    const keys = [];
    const action = vi.fn(async (key) => { keys.push(key); throw rejected(); });
    const { result } = renderHook(() => useSubmit(action));
    await act(() => result.current.submit());
    await act(() => result.current.submit());
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('після успіху ключ оновлюється, результат повертається', async () => {
    const keys = [];
    const action = vi.fn(async (key) => { keys.push(key); return { data: 'ok' }; });
    const { result } = renderHook(() => useSubmit(action));
    let first; await act(async () => { first = await result.current.submit(); });
    await act(() => result.current.submit());
    expect(first).toEqual({ data: 'ok' });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('блокує подвійне натискання, поки запит виконується', async () => {
    let release;
    const action = vi.fn(() => new Promise((resolve) => { release = () => resolve({ data: 1 }); }));
    const { result } = renderHook(() => useSubmit(action));
    let p1; let p2;
    act(() => { p1 = result.current.submit(); p2 = result.current.submit(); });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => { release(); await p1; await p2; });
    expect(result.current.busy).toBe(false);
  });
});
