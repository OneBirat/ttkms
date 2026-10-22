"use client";

import styles from "./admin.module.css";

export interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** On/off switch as a button with aria-pressed (44px tall, label clickable). */
export function Toggle({ label, hint, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleTrack} aria-hidden="true" />
      <span className={styles.toggleText}>
        <span>{label}</span>
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </span>
    </button>
  );
}
