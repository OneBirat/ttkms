"use client";

import { useEffect, useState } from "react";

export const PHONE_QUERY = "(max-width: 639px)";

/**
 * True under 640px (the design's phone layouts), false on wider screens,
 * null until the first client render so the server markup stays neutral.
 */
export function useIsPhone(): boolean | null {
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
