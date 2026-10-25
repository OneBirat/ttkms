"use client";

import { useState, type FormEvent } from "react";
import { createDepartment } from "../api";
import { cleanDepartmentName, validateDepartmentName } from "../_lib/departments";
import { payrollErrorMessage } from "../_lib/usePayroll";
import type { Department } from "../types";
import styles from "./payroll.module.css";

export interface AddDepartmentFormProps {
  /** Departments already there, for the live duplicate check. */
  existing: readonly Department[];
  onCreated: (department: Department) => void;
  onCancel?: () => void;
  /** "New department name" by default. */
  placeholder?: string;
  id: string;
}

/**
 * The one "+ Add department" form: an input, Add and Cancel. Used inline in the Add employee
 * popup ("+ Add new department…" selects the new one) and in the Manage departments dialog.
 * Validates like the server (trimmed, required, unique case-insensitively) before POSTing.
 */
export function AddDepartmentForm({ existing, onCreated, onCancel, placeholder = "New department name", id }: AddDepartmentFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const problem = validateDepartmentName(name, existing);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const created = await createDepartment(cleanDepartmentName(name));
      setName("");
      setError(null);
      onCreated(created);
    } catch (err) {
      setError(payrollErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.fieldCol} style={{ gridColumn: "1 / -1" }}>
      <div className={styles.inlineAdd}>
        <label htmlFor={id} className={styles.srOnly}>
          {placeholder}
        </label>
        <div className={`field ${error ? styles.fieldInvalid : ""}`} style={{ flex: "1 1 auto" }}>
          <input
            id={id}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            maxLength={120}
            autoFocus
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Adding…" : "Add department"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
