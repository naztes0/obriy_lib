import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '../api/client.js';

export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, meta: null, error: null, loading: true });
  const counter = useRef(0);

  const run = useCallback(() => {
    const id = ++counter.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((result) => {
        if (id === counter.current) {
          setState({ data: result.data, meta: result.meta ?? null, error: null, loading: false });
        }
      })
      .catch((error) => {
        if (id === counter.current && error?.name !== 'AbortError') {
          setState((s) => ({ ...s, error, loading: false }));
        }
      });
  }, deps);

  useEffect(() => {
    run();
    return () => {
      counter.current += 1;
    };
  }, [run]);

  return { ...state, reload: run };
}

export function useSubmit(action) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyRef = useRef(newIdempotencyKey());
  const busyRef = useRef(false);

  const submit = useCallback(
    async (...args) => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await action(keyRef.current, ...args);
        keyRef.current = newIdempotencyKey();
        return result;
      } catch (caught) {
        if (!caught?.isUnconfirmed) keyRef.current = newIdempotencyKey();
        setError(caught);
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [action],
  );

  return { submit, busy, error, clearError: () => setError(null) };
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
