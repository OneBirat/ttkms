"use client";

import { LockIcon } from "./icons";
import type { DayLock } from "./types";
import styles from "./lock.module.css";

export interface LockBannerProps {
  lock: DayLock | null | undefined;
  /** Phone layout: edge to edge under the header, with a "Today" button. */
  phone?: boolean;
  onToday?: () => void;
}

/**
 * The banner above the staff list on a past day. Grey with a padlock for everyone:
 * "Locked · Kartik 14, 2083 · Only the super admin can change past attendance."
 * Nothing on an open day (today).
 */
export function LockBanner({ lock, phone = false, onToday }: LockBannerProps) {
  if (!lock || lock.mode === "open") return null;
  return (
    <div role="status" className={styles.banner} data-mode={lock.mode} data-phone={phone || undefined}>
      <LockIcon size={16} className={styles.icon} />
      <span className={styles.text}>{lock.message}</span>
      {onToday ? (
        <button type="button" className={styles.today} onClick={onToday}>
          Today
        </button>
      ) : null}
    </div>
  );
}
