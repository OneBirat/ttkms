"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import styles from "./admin.module.css";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** Wraps the whole field in `grid-column: 1 / -1`. */
  span?: boolean;
  className?: string;
  /** Render prop receives the ids to wire aria attributes on the control. */
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

/** Label + control + hint/error with the aria wiring done once. */
export function Field({ label, hint, error, span, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const classes = [styles.field, span ? styles.span2 : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <span id={errorId ?? undefined} className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId ?? undefined} className={styles.fieldHint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function inputClass(invalid: boolean, extra?: string): string {
  return ["input", invalid ? styles.inputError : "", extra ?? ""].filter(Boolean).join(" ");
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/** Native <select> styled like the design's field (custom chevron). */
export function Select({ invalid = false, className, children, ...rest }: SelectProps) {
  return (
    <span className={styles.selectWrap}>
      <select
        className={inputClass(invalid, `${styles.select} ${className ?? ""}`)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <svg
        className={styles.selectChevron}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}
