"use client";

import type { ReactNode } from "react";
import { useIsPhone } from "../_lib/useIsPhone";

/** Renders the phone or the desktop screen for the same route (< 640px = phone). */
export function Responsive({ phone, desktop }: { phone: ReactNode; desktop: ReactNode }) {
  const isPhone = useIsPhone();
  if (isPhone === null) {
    return (
      <p className="muted" role="status" style={{ padding: 16 }}>
        Loading…
      </p>
    );
  }
  return <>{isPhone ? phone : desktop}</>;
}
