"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The phone layout of Mark attendance (design/attendance/AttendanceMarkMobile.dc.html). */
export const PHONE_QUERY = "(max-width: 639px)";

/**
 * True while the media query matches. The server snapshot is `false`, so the
 * first client render matches SSR and the phone layout appears right after
 * hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
