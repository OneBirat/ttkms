"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribe } from "./api";

export interface PayrollQuery<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` once, again on `reload()`, and again whenever the mock store
 * changes (so a photo saved from the phone shows up by itself). `deps` work
 * like useEffect deps: the query reloads when they change.
 */
export function usePayroll<T>(load: () => Promise<T>, deps: unknown[]): PayrollQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      loadRef
        .current()
        .then((value) => {
          if (cancelled) return;
          setData(value);
          setError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err);
          setLoading(false);
        });
    };
    setLoading(true);
    run();
    const unsubscribe = subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** Human-readable message for anything the mock API throws. */
export function payrollErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
