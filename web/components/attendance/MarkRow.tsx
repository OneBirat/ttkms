"use client";

import { memo } from "react";
import type { Draft } from "./helpers";
import type { EmployeeRef } from "./types";
import styles from "./mark.module.css";

export interface MarkRowProps {
  employee: EmployeeRef;
  draft: Draft;
  onStatus: (employeeId: number, status: "P" | "A") => void;
  onOvertime: (employeeId: number) => void;
  onNote: (employeeId: number, note: string) => void;
}

function MarkRowInner({ employee, draft, onStatus, onOvertime, onNote }: MarkRowProps) {
  const open = draft.status === null;
  return (
    <tr className={open ? styles.rowOpen : undefined}>
      <td>
        <div className={styles.who}>
          <span className={styles.name}>{employee.name}</span>
          <span className={styles.meta}>
            {employee.code} · {employee.department_name} · {employee.branch_name}
          </span>
        </div>
      </td>
      <td>
        <div role="group" aria-label={`Status for ${employee.name}`} className={styles.statusGroup}>
          <button
            type="button"
            className={styles.st}
            data-status="P"
            aria-pressed={draft.status === "P"}
            onClick={() => onStatus(employee.id, "P")}
          >
            Present
          </button>
          <button
            type="button"
            className={styles.st}
            data-status="O"
            aria-pressed={draft.status === "O"}
            aria-haspopup="dialog"
            onClick={() => onOvertime(employee.id)}
          >
            {draft.status === "O" ? `Overtime · ${draft.ot_hours} h` : "Overtime"}
          </button>
          <button
            type="button"
            className={styles.st}
            data-status="A"
            aria-pressed={draft.status === "A"}
            onClick={() => onStatus(employee.id, "A")}
          >
            Absent
          </button>
        </div>
      </td>
      <td>
        <input
          className={styles.note}
          aria-label={`Note, ${employee.name}`}
          maxLength={200}
          value={draft.note}
          onChange={(e) => onNote(employee.id, e.target.value)}
        />
      </td>
    </tr>
  );
}

/** Memoised so a 100+ row table re-renders only the row that changed. */
export const MarkRow = memo(MarkRowInner);
