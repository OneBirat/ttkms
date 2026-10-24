/** Small pure helpers for the People screens (unit-tested). */

import { formatNumber } from "@/lib/format";
import type {
  Department,
  Employee,
  EmployeeSort,
  MonthLedger,
  MonthStatus,
  PaymentType,
  ReportRow,
  ReportSort,
  ReportTotals,
  TodayStatus,
} from "../types";

/** "Rs 1,23,456" (en-IN grouping). */
export function formatRs(value: number): string {
  return `Rs ${formatNumber(Math.round(value))}`;
}

/** "1,23,456" without the prefix, for table cells. */
export function formatAmount(value: number): string {
  return formatNumber(Math.round(value));
}

/** "−1,234" for a deduction, "0" when nothing was deducted. */
export function formatDeduction(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `−${formatNumber(rounded)}` : "0";
}

/** "+1,200" for an addition, "0" when nothing was added. */
export function formatAddition(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${formatNumber(rounded)}` : "0";
}

/** "29 / 30" or "29.5 / 30". */
export function formatPaidDays(paid: number, total: number): string {
  return `${formatDays(paid)} / ${total}`;
}

/** 29.5 -> "29.5", 29 -> "29" */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/** "Rs 1.23L" style label for chart bars (lakh). */
export function formatLakh(value: number): string {
  return `${(value / 100000).toFixed(2)}L`;
}

/** "8 h" */
export function formatHours(hours: number): string {
  return `${formatDays(hours)} h`;
}

export const STATUS_LABEL: Record<MonthStatus, string> = {
  paid: "Paid",
  part_paid: "Part paid",
  pending: "Pending",
};

/** Pill status keyword understood by components/ui/Pill (ok / low / neutral). */
export function statusPill(status: MonthStatus): string {
  return status === "paid" ? "paid" : status === "part_paid" ? "pending" : "neutral";
}

/** "Anita Gurung" -> "AG"; "Ramesh K.C." -> "RK" */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Case- and whitespace-insensitive match on name, code or barcode. */
export function matchesEmployee(employee: Employee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const code = employee.code.toLowerCase();
  return (
    employee.full_name.toLowerCase().includes(q) ||
    code.includes(q) ||
    employee.barcode.toLowerCase().includes(q) ||
    code.replace(/^e-?/, "").startsWith(q.replace(/^e-?/, ""))
  );
}

/** Digits only, so "98-123" and "98 123" count as the same phone. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "sarita.b" from "Sarita Basnet": first name + initial of the last. */
export function suggestUsername(fullName: string): string {
  const parts = fullName
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts[parts.length - 1][0]}`;
}

/** "E-025" -> "TTK-E025" (the Code 128 value on the sticker). */
export function barcodeFor(code: string): string {
  return `TTK-${code.replace(/-/g, "")}`;
}

/** 25 -> "E-025" */
export function employeeCode(id: number): string {
  return `E-${String(id).padStart(3, "0")}`;
}

export function departmentCounts(
  employees: Employee[],
  departments: Department[],
): { department: Department; count: number }[] {
  return departments.map((department) => ({
    department,
    count: employees.filter((e) => e.department?.id === department.id).length,
  }));
}

export function sortEmployees(employees: Employee[], sort: EmployeeSort): Employee[] {
  const byName = (a: Employee, b: Employee) => a.full_name.localeCompare(b.full_name);
  const comparators: Record<EmployeeSort, (a: Employee, b: Employee) => number> = {
    name: byName,
    code: (a, b) => a.code.localeCompare(b.code),
    designation: (a, b) => (a.designation ?? "").localeCompare(b.designation ?? "") || byName(a, b),
  };
  return [...employees].sort(comparators[sort]);
}

export interface DepartmentGroup {
  department: Department | null;
  employees: Employee[];
}

/** Employees grouped in department order, each group sorted; "No department" last. */
export function groupByDepartment(
  employees: Employee[],
  departments: Department[],
  sort: EmployeeSort = "name",
): DepartmentGroup[] {
  const groups: DepartmentGroup[] = departments
    .map((department) => ({
      department,
      employees: sortEmployees(employees.filter((e) => e.department?.id === department.id), sort),
    }))
    .filter((group) => group.employees.length > 0);
  const none = sortEmployees(employees.filter((e) => !e.department), sort);
  if (none.length) groups.push({ department: null, employees: none });
  return groups;
}

export function sortRows(rows: ReportRow[], sort: ReportSort, departments: Department[]): ReportRow[] {
  const order = departments.map((d) => d.id);
  const byName = (a: ReportRow, b: ReportRow) => a.employee.full_name.localeCompare(b.employee.full_name);
  const deptIndex = (row: ReportRow) => {
    const id = row.employee.department?.id;
    const index = id === undefined ? -1 : order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  const comparators: Record<ReportSort, (a: ReportRow, b: ReportRow) => number> = {
    dept: (a, b) => deptIndex(a) - deptIndex(b) || byName(a, b),
    name: byName,
    net: (a, b) => b.ledger.net - a.ledger.net || byName(a, b),
    due: (a, b) => b.ledger.due - a.ledger.due || byName(a, b),
    paid_days: (a, b) => a.ledger.paid_days - b.ledger.paid_days || byName(a, b),
  };
  return [...rows].sort(comparators[sort]);
}

export function totalsFor(ledgers: MonthLedger[]): ReportTotals {
  const sum = (pick: (l: MonthLedger) => number) => ledgers.reduce((acc, l) => acc + pick(l), 0);
  return {
    staff: ledgers.length,
    gross: sum((l) => l.earnings),
    absence_deduction: sum((l) => l.absence_deduction),
    absent_days: sum((l) => l.attendance.absent),
    overtime_pay: sum((l) => l.overtime_pay),
    overtime_hours: sum((l) => l.attendance.overtime_hours),
    advance_paid: sum((l) => l.advance_paid),
    salary_paid: sum((l) => l.salary_paid),
    tds: sum((l) => l.tds),
    net: sum((l) => l.net),
    due: sum((l) => l.due),
    paid_count: ledgers.filter((l) => l.status === "paid").length,
    part_paid_count: ledgers.filter((l) => l.status === "part_paid").length,
    pending_count: ledgers.filter((l) => l.status === "pending").length,
  };
}

/** Rows for page `page` (1-based) at `size` per page. */
export function paginate<T>(items: T[], page: number, size: number): { items: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * size, current * size), pages, page: current };
}

/** Percent change from `from` to `to`, rounded; null when `from` is 0. */
export function percentChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return Math.round(((to - from) / from) * 100);
}

/** RFC 4180-ish CSV: quotes fields that need it, CRLF line ends, BOM for Excel. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers, ...rows].map((row) => row.map(escape).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Deterministic avatar background for an employee without a photo. */
export function avatarTone(id: number): number {
  return id % 6;
}

/** Quick amounts in the Give advance dialog (plus "Max <room>" when room is larger). */
export const ADVANCE_QUICK = [500, 1000, 2000, 3000] as const;

/** "ADV-0412" / "SAL-0410" */
export function receiptNo(type: PaymentType, id: number): string {
  return `${type === "advance" ? "ADV" : "SAL"}-${String(id).padStart(4, "0")}`;
}

export const TODAY_LABEL: Record<TodayStatus, string> = {
  present: "Present",
  overtime: "Overtime",
  absent: "Absent",
  weekly_off: "Weekly off",
  not_marked: "Not marked",
};

export function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

/** Groups consecutive items by key, keeping first-seen order. */
export function groupBy<T, K extends string | number>(items: T[], keyOf: (item: T) => K): { key: K; items: T[] }[] {
  const groups: { key: K; items: T[] }[] = [];
  const index = new Map<K, { key: K; items: T[] }>();
  for (const item of items) {
    const key = keyOf(item);
    let group = index.get(key);
    if (!group) {
      group = { key, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
