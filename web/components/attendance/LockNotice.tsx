"use client";

import styles from "./lock.module.css";

/**
 * "Attendance for Kartik 3, 2083 is locked. Only the super admin can change it." as a pop-up
 * at the bottom of the screen. It goes away by itself after 3 s (useMarkState) or on a tap.
 */
export function LockNotice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className={styles.notice} onClick={onClose}>
      <svg className={styles.icon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
