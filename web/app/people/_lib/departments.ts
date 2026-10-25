/**
 * Pure rules of the "Manage departments" dialog (tested in __tests__/departments.test.mjs).
 * Departments are company-wide rows of core.departments served by /api/core/departments; the
 * server applies the same rules (app/core/departments.py) and the UI mirrors them so the buttons
 * are right before the round trip.
 */

import type { Department } from "../types";

export const DEPARTMENT_NAME_MAX = 120;

/** Collapse inner whitespace and trim, the way the server (and its unique index) normalises. */
export function cleanDepartmentName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Validation message for a new or renamed department, or null when fine. `exceptId` is the
 * department being renamed (its own name is not a clash).
 */
export function validateDepartmentName(
  value: string,
  existing: readonly Department[],
  exceptId: number | null = null,
): string | null {
  const clean = cleanDepartmentName(value);
  if (!clean) return "Department name is required.";
  if (clean.length > DEPARTMENT_NAME_MAX) return `Department name must be ${DEPARTMENT_NAME_MAX} characters or fewer.`;
  const key = clean.toLowerCase();
  const clash = existing.find((d) => d.id !== exceptId && d.name.toLowerCase() === key);
  return clash ? `A department named "${clash.name}" already exists.` : null;
}

export interface DeleteState {
  /** Delete is only possible while nobody - active or former - is in the department. */
  enabled: boolean;
  /** Why not, for the disabled button ("Move 3 employees first (includes former staff)"). */
  hint: string | null;
}

export function deleteState(department: Pick<Department, "employee_count" | "active_employee_count">): DeleteState {
  const total = department.employee_count;
  if (total === 0) return { enabled: true, hint: null };
  const former = total - department.active_employee_count;
  const who = `${total} employee${total === 1 ? "" : "s"}`;
  return { enabled: false, hint: `Move ${who} first${former > 0 ? " (includes former staff)" : ""}` };
}

/** "3 employees · 1 former" / "1 employee" / "No employees" - the count shown next to the name. */
export function countText(department: Pick<Department, "employee_count" | "active_employee_count">): string {
  const total = department.employee_count;
  if (total === 0) return "No employees";
  const former = total - department.active_employee_count;
  const base = `${total} employee${total === 1 ? "" : "s"}`;
  return former > 0 ? `${base} · ${former} former` : base;
}

export function deleteConfirmText(department: Pick<Department, "name">): string {
  return `Delete department ${department.name} permanently?`;
}
