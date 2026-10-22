"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { AdminUser, EmployeeRef } from "../types";
import { Field, inputClass } from "../components/Field";
import styles from "../components/admin.module.css";

export interface EmployeePickerProps {
  employees: EmployeeRef[];
  users: AdminUser[];
  /** User being edited (its own link is allowed), null when creating. */
  editingId: number | null;
  value: number | null;
  onChange: (employeeId: number | null) => void;
}

const MAX_RESULTS = 8;

/** Searchable select (combobox + listbox) for "Link to employee". */
export function EmployeePicker({
  employees,
  users,
  editingId,
  value,
  onChange,
}: EmployeePickerProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = employees.find((e) => e.id === value) ?? null;

  const linkedBy = useMemo(() => {
    const map = new Map<number, string>();
    for (const user of users) {
      if (user.employee && user.id !== editingId) map.set(user.employee.id, user.username);
    }
    return map;
  }, [users, editingId]);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return employees
      .filter((e) => e.status === "active" || e.id === value)
      .filter((e) => {
        if (words.length === 0) return true;
        const hay = `${e.code} ${e.full_name} ${e.department ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, MAX_RESULTS);
  }, [employees, query, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (employee: EmployeeRef) => {
    if (linkedBy.has(employee.id)) return;
    onChange(employee.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <Field
      label="Link to employee"
      hint="Optional. Connects the login to the attendance and payslip records."
    >
      {({ id, describedBy }) => (
        <div ref={wrapRef} style={{ position: "relative" }}>
          {selected ? (
            <div className={styles.inputRow}>
              <span
                className="input"
                style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 200px" }}
                id={id}
              >
                <span className={styles.code}>{selected.code}</span>
                <span>{selected.full_name}</span>
                {selected.department ? (
                  <span className="muted">· {selected.department}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => onChange(null)}
                aria-label={`Unlink ${selected.full_name}`}
              >
                <Icon name="close" size={16} />
                Unlink
              </button>
            </div>
          ) : (
            <input
              id={id}
              className={inputClass(false)}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-describedby={describedBy}
              aria-activedescendant={
                open && results[cursor] ? `${listId}-${results[cursor].id}` : undefined
              }
              placeholder="Search by name or E-code"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (event.key === "Enter" && open && results[cursor]) {
                  event.preventDefault();
                  pick(results[cursor]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          )}
          {open && !selected ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Employees"
              className={`card ${styles.list}`}
              style={{
                position: "absolute",
                zIndex: 5,
                left: 0,
                right: 0,
                top: "calc(100% + 4px)",
                maxHeight: 280,
                overflowY: "auto",
                padding: 4,
                boxShadow: "0 12px 30px rgba(0,0,0,0.15)",
              }}
            >
              {results.length === 0 ? (
                <li className="muted" style={{ padding: "10px 12px" }}>
                  No matching employee.
                </li>
              ) : (
                results.map((employee, index) => {
                  const taken = linkedBy.get(employee.id);
                  return (
                    <li
                      key={employee.id}
                      id={`${listId}-${employee.id}`}
                      role="option"
                      aria-selected={index === cursor}
                      aria-disabled={taken ? true : undefined}
                    >
                      <button
                        type="button"
                        className={styles.ghost}
                        style={{
                          width: "100%",
                          justifyContent: "flex-start",
                          minHeight: 44,
                          color: taken ? "var(--color-muted)" : "var(--color-text)",
                          background:
                            index === cursor ? "var(--color-bg)" : "transparent",
                        }}
                        disabled={Boolean(taken)}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => pick(employee)}
                      >
                        <span className={styles.code}>{employee.code}</span>
                        <span>{employee.full_name}</span>
                        {employee.department ? (
                          <span className="muted">· {employee.department}</span>
                        ) : null}
                        {taken ? <span className="muted">· linked to {taken}</span> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}
