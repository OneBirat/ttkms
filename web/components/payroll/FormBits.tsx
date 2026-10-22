"use client";

import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from "react";
import styles from "./payroll.module.css";

export interface FieldProps {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  span2?: boolean;
  children: ReactNode;
}

/** Label + control + inline error, in the design's 13px/600 label style. */
export function Field({ id, label, error, hint, span2, children }: FieldProps) {
  return (
    <div className={span2 ? `${styles.fieldCol} ${styles.span2}` : styles.fieldCol}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className={styles.note}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  invalid?: boolean;
  prefix?: string;
  mono?: boolean;
}

/** `.field` box around a bare input, with an optional "Rs" prefix. */
export function TextInput({ id, invalid, prefix, mono, className, ...rest }: TextInputProps) {
  return (
    <div className={invalid ? `field ${styles.fieldInvalid}` : "field"}>
      {prefix ? <span className={styles.prefix}>{prefix}</span> : null}
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={[mono ? styles.monoInput : "", className ?? ""].join(" ").trim() || undefined}
        {...rest}
      />
    </div>
  );
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  invalid?: boolean;
  children: ReactNode;
}

/** `.field` box around a bare select with a visible chevron. */
export function SelectInput({ id, invalid, children, ...rest }: SelectInputProps) {
  return (
    <div className={`field ${styles.selectWrap}${invalid ? ` ${styles.fieldInvalid}` : ""}`}>
      <select
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

/** Reads a PayrollApiError into { field: message } or a general message. */
export function splitError(error: unknown): { field: string | null; message: string } {
  if (error && typeof error === "object" && "detail" in error) {
    const e = error as { detail?: unknown; field?: unknown };
    return {
      field: typeof e.field === "string" ? e.field : null,
      message: typeof e.detail === "string" ? e.detail : "Something went wrong.",
    };
  }
  return { field: null, message: error instanceof Error ? error.message : "Something went wrong." };
}

/** "22000" -> 22000; blanks and junk -> NaN. */
export function parseAmount(value: string): number {
  const clean = value.replace(/[^\d.]/g, "");
  return clean ? Number(clean) : Number.NaN;
}
