"use client";

import styles from "./admin.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Disable Sita Thapa" or the permission label. */
  label: string;
  disabled?: boolean;
  title?: string;
  size?: "md" | "lg";
}

/** On/off switch from the design (44×26, teal when on): role="switch". */
export function Switch({ checked, onChange, label, disabled, title, size = "md" }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={`${styles.switch} ${size === "lg" ? styles.switchLg : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchKnob} aria-hidden="true" />
    </button>
  );
}
