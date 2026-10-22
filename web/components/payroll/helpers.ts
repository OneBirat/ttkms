/** Small pure helpers for the payroll screens (unit-tested). */

import { formatNumber } from "@/lib/format";
import type {
  Department,
  EmployeeProfile,
  PayrollSheetRow,
  PayrollTotals,
  Payslip,
  ReportSort,
} from "./types";

/** "Rs 1,23,456" (en-IN grouping). */
export function formatRs(value: number): string {
  return `Rs ${formatNumber(Math.round(value))}`;
}

/** "−1,234" for a deduction, "0" when nothing was deducted. */
export function formatDeduction(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `−${formatNumber(rounded)}` : "0";
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

/** Case- and whitespace-insensitive match on name or employee code. */
export function matchesEmployee(employee: EmployeeProfile, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    employee.full_name.toLowerCase().includes(q) ||
    employee.code.toLowerCase().includes(q) ||
    employee.code.toLowerCase().replace(/^e-?/, "").startsWith(q.replace(/^e-?/, ""))
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

export function departmentCounts(
  employees: EmployeeProfile[],
  departments: Department[],
): { department: Department; count: number }[] {
  return departments.map((department) => ({
    department,
    count: employees.filter((e) => e.department?.id === department.id).length,
  }));
}

export interface DepartmentGroup {
  department: Department | null;
  employees: EmployeeProfile[];
}

/** Employees grouped in department order, names sorted; "No department" last. */
export function groupByDepartment(
  employees: EmployeeProfile[],
  departments: Department[],
): DepartmentGroup[] {
  const byName = (a: EmployeeProfile, b: EmployeeProfile) =>
    a.full_name.localeCompare(b.full_name);
  const groups: DepartmentGroup[] = departments
    .map((department) => ({
      department,
      employees: employees.filter((e) => e.department?.id === department.id).sort(byName),
    }))
    .filter((group) => group.employees.length > 0);
  const none = employees.filter((e) => !e.department).sort(byName);
  if (none.length) groups.push({ department: null, employees: none });
  return groups;
}

export function sortRows(
  rows: PayrollSheetRow[],
  sort: ReportSort,
  departments: Department[],
): PayrollSheetRow[] {
  const order = departments.map((d) => d.id);
  const byName = (a: PayrollSheetRow, b: PayrollSheetRow) =>
    a.employee.full_name.localeCompare(b.employee.full_name);
  const deptIndex = (row: PayrollSheetRow) => {
    const id = row.employee.department?.id;
    const index = id === undefined ? -1 : order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  const comparators: Record<ReportSort, (a: PayrollSheetRow, b: PayrollSheetRow) => number> = {
    dept: (a, b) => deptIndex(a) - deptIndex(b) || byName(a, b),
    name: byName,
    net: (a, b) => b.payslip.net_pay - a.payslip.net_pay || byName(a, b),
    unpaid: (a, b) => b.payslip.unpaid_days - a.payslip.unpaid_days || byName(a, b),
  };
  return [...rows].sort(comparators[sort]);
}

export function totalsFor(payslips: Payslip[], advanceOutstanding: number): PayrollTotals {
  const sum = (pick: (p: Payslip) => number) =>
    payslips.reduce((acc, p) => acc + pick(p), 0);
  return {
    staff: payslips.length,
    gross: sum((p) => p.gross),
    absence_deduction: sum((p) => p.absence_deduction),
    unpaid_days: sum((p) => p.unpaid_days),
    advance_recovered: sum((p) => p.advance_recovered),
    advance_outstanding: advanceOutstanding,
    net_pay: sum((p) => p.net_pay),
    paid_count: payslips.filter((p) => p.status === "paid").length,
    pending_count: payslips.filter((p) => p.status === "pending").length,
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
