"use client";

import { useId, useRef, type ChangeEvent } from "react";
import { useBsDatepicker } from "@/lib/bsDatepicker";
import styles from "./BsDateInput.module.css";

export interface BsDateInputProps {
  name: string;
  /** BS date as "YYYY-MM-DD". */
  value: string;
  /** Controlled when given; otherwise the input is uncontrolled (plain form post). */
  onChange?: (value: string) => void;
  id?: string;
  required?: boolean;
  label?: string;
  placeholder?: string;
}

export function BsDateInput({
  name,
  value,
  onChange,
  id,
  required,
  label,
  placeholder = "YYYY-MM-DD",
}: BsDateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const ref = useRef<HTMLInputElement>(null);
  useBsDatepicker(ref, onChange);

  const valueProps = onChange
    ? {
        value,
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value),
      }
    : { defaultValue: value };

  return (
    <div className={styles.field}>
      {label ? (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        name={name}
        type="text"
        className={`input ${styles.input}`}
        inputMode="numeric"
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        aria-describedby={hintId}
        {...valueProps}
      />
      <span id={hintId} className={styles.hint}>
        Bikram Sambat, YYYY-MM-DD
      </span>
    </div>
  );
}
