"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, isAbortError } from "@/lib/api";

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads a GET endpoint once on mount (and again on `reload()`), cancelling the
 * in-flight request when the component unmounts or the path changes.
 */
export function useApi<T>(path: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<T>(path, { signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        setData(body);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, error, loading, reload };
}
