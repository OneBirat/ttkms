"use client";

import { memo } from "react";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type EmployeeRef } from "./types";
import { STATUS_META } from "./helpers";
import styles from "./mark.module.css";

export interface RowDraft {
  status: AttendanceStatus | null;
  in_time: string;
  out_time: string;
  note: string;
}

export interface MarkRowProps {
  employee: EmployeeRef;
  value: RowDraft;
  onChange: (employeeId: number, patch: Partial<RowDraft>) => void;
}

function MarkRowInner({ employee, value, onChange }: MarkRowProps) {
  const open = value.status === null;
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
          {ATTENDANCE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={styles.st}
              data-status={status}
              aria-pressed={value.status === status}
              onClick={() => onChange(employee.id, { status })}
            >
              {STATUS_META[status].short}
            </button>
          ))}
        </div>
      </td>
      <td>
        <input
          className={styles.time}
          aria-label={`In time, ${employee.name}`}
          inputMode="numeric"
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          maxLength={5}
          value={value.in_time}
          onChange={(e) => onChange(employee.id, { in_time: e.target.value })}
        />
      </td>
      <td>
        <input
          className={styles.time}
          aria-label={`Out time, ${employee.name}`}
          inputMode="numeric"
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          maxLength={5}
          value={value.out_time}
          onChange={(e) => onChange(employee.id, { out_time: e.target.value })}
        />
      </td>
      <td>
        <input
          className={styles.note}
          aria-label={`Note, ${employee.name}`}
          maxLength={200}
          value={value.note}
          onChange={(e) => onChange(employee.id, { note: e.target.value })}
        />
      </td>
    </tr>
  );
}

/** Memoised so a 100+ row table re-renders only the row that changed. */
export const MarkRow = memo(MarkRowInner);
