"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LoaderState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** Replace the loaded value locally (after a mutation) without refetching. */
  setData: (updater: (current: T | null) => T | null) => void;
}

/**
 * Runs an async loader on mount and whenever `key` changes; stale results
 * are dropped. The mock API functions are plain promises, so this is the
 * module-local twin of lib/useApi (which only takes a URL).
 */
export function useLoader<T>(load: () => Promise<T>, key: string = ""): LoaderState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((value) => {
        if (cancelled) return;
        setDataState(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback(
    (updater: (current: T | null) => T | null) => setDataState((current) => updater(current)),
    [],
  );

  return { data, error, loading, reload, setData };
}
