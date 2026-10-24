"use client";

import { memo, type MouseEvent } from "react";
import { CheckIcon } from "./icons";
import { initials } from "./helpers";
import type { CellStatus, EmployeeRef } from "./types";
import styles from "./mark.module.css";

/** Avatar tints for the "Show employee photos" toggle until real photos exist. */
export const PHOTO_TINTS = ["#6E5A4B", "#4F6B5A", "#7A5566", "#4E6380", "#7C6A3F"];

export function photoTint(employeeId: number): string {
  return PHOTO_TINTS[employeeId % PHOTO_TINTS.length];
}

export interface MarkRowProps {
  employee: EmployeeRef;
  status: CellStatus;
  hours: number;
  photos: boolean;
  /** "Not marked" filter: show the selection checkbox. */
  bulk: boolean;
  selected: boolean;
  pending: boolean;
  onToggleSelect: (employeeId: number) => void;
  onPick: (employeeId: number, status: "P" | "A") => void;
  onOvertime: (employeeId: number) => void;
  onOpenProfile: (employeeId: number, departmentId: number) => void;
}

function MarkRowInner({
  employee,
  status,
  hours,
  photos,
  bulk,
  selected,
  pending,
  onToggleSelect,
  onPick,
  onOvertime,
  onOpenProfile,
}: MarkRowProps) {
  const open = status === "N";
  const href = `/people/employees/${employee.id}?dept=${employee.department_id}`;
  const onNameClick = (event: MouseEvent) => event.preventDefault(); // single click does nothing
  const onNameDouble = (event: MouseEvent) => {
    event.preventDefault();
    onOpenProfile(employee.id, employee.department_id);
  };
  return (
    <tr className={open ? styles.rowOpen : undefined} aria-busy={pending || undefined}>
      {bulk ? (
        <td className={styles.selectCol}>
          <input
            type="checkbox"
            aria-label={`Select ${employee.name}`}
            checked={selected}
            disabled={!open}
            onChange={() => onToggleSelect(employee.id)}
          />
        </td>
      ) : null}
      <td>
        <div className={styles.who}>
          {photos ? (
            <span
              role="img"
              aria-label={`Photo of ${employee.name}`}
              className={styles.photo}
              style={{ background: photoTint(employee.id) }}
            >
              {initials(employee.name)}
            </span>
          ) : null}
          <div className={styles.whoText}>
            <a
              href={href}
              className={styles.nameLink}
              title={`Double-click to open ${employee.name}'s profile`}
              onClick={onNameClick}
              onDoubleClick={onNameDouble}
            >
              {employee.name}
            </a>
            <span className={styles.meta}>
              {employee.code} · {employee.department_name}
            </span>
          </div>
        </div>
      </td>
      <td>
        <div role="group" aria-label={`Status for ${employee.name}`} className={styles.statusGroup}>
          <button
            type="button"
            className={styles.st}
            data-status="P"
            aria-pressed={status === "P"}
            disabled={pending}
            onClick={() => onPick(employee.id, "P")}
          >
            <span className={styles.stInner}>
              {status === "P" ? <CheckIcon size={16} /> : null}
              Present
            </span>
          </button>
          <button
            type="button"
            className={styles.st}
            data-status="O"
            aria-pressed={status === "O"}
            aria-haspopup="dialog"
            disabled={pending}
            onClick={() => onOvertime(employee.id)}
          >
            <span className={styles.stInner}>{status === "O" ? `Overtime · ${hours} h` : "Overtime"}</span>
          </button>
          <button
            type="button"
            className={styles.st}
            data-status="A"
            aria-pressed={status === "A"}
            disabled={pending}
            onClick={() => onPick(employee.id, "A")}
          >
            <span className={styles.stInner}>Absent</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Memoised so a 100+ row table re-renders only the row that changed. */
export const MarkRow = memo(MarkRowInner);
