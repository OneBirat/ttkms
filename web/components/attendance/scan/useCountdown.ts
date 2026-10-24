"use client";

import { useEffect, useState } from "react";

/**
 * Seconds left of a countdown that started at `token` (a Date.now() value)
 * and lasts `totalMs`. Re-renders once a second; 0 when over or without a token.
 */
export function useSecondsLeft(token: number | null | undefined, totalMs: number): number {
  const compute = () => {
    if (!token) return 0;
    return Math.max(0, Math.ceil((totalMs - (Date.now() - token)) / 1000));
  };
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    if (!token) return;
    const timer = window.setInterval(() => setLeft(compute()), 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, totalMs]);
  return left;
}
