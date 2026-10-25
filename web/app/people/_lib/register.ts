/**
 * Pure rules of the Payment reports screen (tested in __tests__/register.test.mjs): sort
 * keys, department grouping with subtotals, chip counts. The mock `listPayments` sorts with
 * these; the backend applies the same order for `?sort=`.
 */

import type { Department, DepartmentRef, RegisterRow, RegisterSort } from "../types";

export const REGISTER_SORTS: { value: RegisterSort; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "department", label: "Department" },
  { value: "employee", label: "Employee" },
  { value: "amount", label: "Amount" },
];

export function isRegisterSort(value: string | null | undefined): value is RegisterSort {
  return REGISTER_SORTS.some((s) => s.value === value);
}

function byDateDesc(a: RegisterRow, b: RegisterRow): number {
  return b.payment.date.bs.localeCompare(a.payment.date.bs) || b.payment.id - a.payment.id;
}

function departmentName(row: RegisterRow): string {
  return row.employee.department?.name ?? "";
}

/** Departments A-Z, "no department" last. */
function byDepartment(a: RegisterRow, b: RegisterRow): number {
  const da = departmentName(a);
  const db = departmentName(b);
  if (!da !== !db) return da ? -1 : 1;
  return da.localeCompare(db);
}

/**
 * Date = newest first (default); Department = A-Z (no department last), newest first inside;
 * Employee = name A-Z, newest first inside; Amount = high to low, newest first on ties.
 */
export function sortRegisterRows(rows: readonly RegisterRow[], sort: RegisterSort): RegisterRow[] {
  const list = [...rows];
  switch (sort) {
    case "department":
      return list.sort((a, b) => byDepartment(a, b) || byDateDesc(a, b));
    case "employee":
      return list.sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name) || byDateDesc(a, b));
    case "amount":
      return list.sort((a, b) => b.payment.amount - a.payment.amount || byDateDesc(a, b));
    default:
      return list.sort(byDateDesc);
  }
}

export interface RegisterGroup {
  /** null = payments of employees without a department. */
  department: DepartmentRef | null;
  rows: RegisterRow[];
  salary: number;
  advances: number;
  total: number;
}

export function groupTotals(rows: readonly RegisterRow[]): { salary: number; advances: number; total: number } {
  let salary = 0;
  let advances = 0;
  for (const r of rows) {
    if (r.payment.voided) continue; // listed struck through, counted nowhere
    if (r.payment.kind === "salary") salary += r.payment.amount;
    else advances += r.payment.amount;
  }
  return { salary, advances, total: salary + advances };
}

/** Rows (already in department order) grouped under their department with a subtotal each. */
export function groupRowsByDepartment(rows: readonly RegisterRow[]): RegisterGroup[] {
  const groups: RegisterGroup[] = [];
  for (const row of rows) {
    const id = row.employee.department?.id ?? null;
    let group = groups.find((g) => (g.department?.id ?? null) === id);
    if (!group) {
      group = { department: row.employee.department ?? null, rows: [], salary: 0, advances: 0, total: 0 };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) Object.assign(group, groupTotals(group.rows));
  return groups;
}

/** "All" + one entry per department with its payment count in the rows given (the chips). */
export function departmentPaymentCounts(
  rows: readonly RegisterRow[],
  departments: readonly Department[],
): { department: Department; count: number }[] {
  return departments.map((department) => ({
    department,
    count: rows.filter((r) => r.employee.department?.id === department.id).length,
  }));
}

/** A row of the table once grouping is applied; pagination counts these so subtotals stay whole. */
export type DisplayRow =
  | { kind: "row"; row: RegisterRow }
  | { kind: "group"; group: RegisterGroup }
  | { kind: "subtotal"; group: RegisterGroup };

/** Sort = Department: department heading, rows, subtotal. Other sorts: flat. */
export function displayRows(rows: readonly RegisterRow[], sort: RegisterSort): DisplayRow[] {
  if (sort !== "department") return rows.map((row) => ({ kind: "row", row }));
  const out: DisplayRow[] = [];
  for (const group of groupRowsByDepartment(rows)) {
    out.push({ kind: "group", group });
    for (const row of group.rows) out.push({ kind: "row", row });
    out.push({ kind: "subtotal", group });
  }
  return out;
}
