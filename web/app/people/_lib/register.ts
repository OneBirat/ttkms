/**
 * Pure rules of the Payment reports screen (tested in __tests__/register.test.mjs): sort
 * keys, department grouping with subtotals, chip counts. The mock `listPayments` sorts with
 * these; the backend applies the same order for `?sort=`.
 */

import type { Branch, Department, DepartmentRef, RegisterRow, RegisterSort } from "../types";

export const REGISTER_SORTS: { value: RegisterSort; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "branch", label: "Branch" },
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

function byBranch(a: RegisterRow, b: RegisterRow): number {
  return a.employee.branch.name.localeCompare(b.employee.branch.name) || a.employee.branch.id - b.employee.branch.id;
}

/**
 * Date = newest first (default); Branch = A-Z, departments A-Z inside, newest first; Department =
 * A-Z (no department last), newest first inside - with `allBranches` the branch comes first so the
 * groups nest branch → department; Employee = name A-Z, newest first inside; Amount = high to low,
 * newest first on ties.
 */
export function sortRegisterRows(rows: readonly RegisterRow[], sort: RegisterSort, allBranches = false): RegisterRow[] {
  const list = [...rows];
  switch (sort) {
    case "branch":
      return list.sort((a, b) => byBranch(a, b) || byDepartment(a, b) || byDateDesc(a, b));
    case "department":
      return list.sort((a, b) => (allBranches ? byBranch(a, b) : 0) || byDepartment(a, b) || byDateDesc(a, b));
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

export interface RegisterBranchGroup {
  branch: Branch;
  rows: RegisterRow[];
  salary: number;
  advances: number;
  total: number;
  /** Department groups inside the branch (Sort = Department with All branches); null for Sort = Branch. */
  departments: RegisterGroup[] | null;
}

/** Rows (already in branch order) grouped per branch, optionally with department groups inside. */
export function groupRowsByBranch(rows: readonly RegisterRow[], withDepartments = false): RegisterBranchGroup[] {
  const groups: RegisterBranchGroup[] = [];
  for (const row of rows) {
    let group = groups.find((g) => g.branch.id === row.employee.branch.id);
    if (!group) {
      group = { branch: row.employee.branch, rows: [], salary: 0, advances: 0, total: 0, departments: null };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) {
    Object.assign(group, groupTotals(group.rows));
    if (withDepartments) group.departments = groupRowsByDepartment(group.rows);
  }
  return groups;
}

/** A row of the table once grouping is applied; pagination counts these so subtotals stay whole. */
export type DisplayRow =
  | { kind: "row"; row: RegisterRow }
  | { kind: "branch"; group: RegisterBranchGroup }
  | { kind: "branchSubtotal"; group: RegisterBranchGroup }
  | { kind: "group"; group: RegisterGroup }
  | { kind: "subtotal"; group: RegisterGroup };

/**
 * Sort = Branch: branch heading, rows, branch subtotal. Sort = Department: department heading,
 * rows, subtotal - nested inside branch headings and subtotals when `allBranches`. Other sorts: flat.
 */
export function displayRows(rows: readonly RegisterRow[], sort: RegisterSort, allBranches = false): DisplayRow[] {
  const out: DisplayRow[] = [];
  const pushDepartment = (group: RegisterGroup) => {
    out.push({ kind: "group", group });
    for (const row of group.rows) out.push({ kind: "row", row });
    out.push({ kind: "subtotal", group });
  };
  if (sort === "branch") {
    for (const group of groupRowsByBranch(rows)) {
      out.push({ kind: "branch", group });
      for (const row of group.rows) out.push({ kind: "row", row });
      out.push({ kind: "branchSubtotal", group });
    }
    return out;
  }
  if (sort === "department") {
    if (!allBranches) {
      for (const group of groupRowsByDepartment(rows)) pushDepartment(group);
      return out;
    }
    for (const group of groupRowsByBranch(rows, true)) {
      out.push({ kind: "branch", group });
      for (const dept of group.departments ?? []) pushDepartment(dept);
      out.push({ kind: "branchSubtotal", group });
    }
    return out;
  }
  return rows.map((row) => ({ kind: "row", row }));
}
