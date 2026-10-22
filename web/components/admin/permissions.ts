/**
 * Role descriptions and the read-only roles × areas matrix shown on the
 * Users & roles page. Keep in step with the backend `require_role(...)`
 * guards; this file is the owner-facing explanation, not the enforcement.
 */

import type { Role } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  store_keeper: "Store keeper",
  staff: "Staff",
};

/** One line per role, shown next to the Role select in the user form. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, including users, settings and the audit log.",
  manager: "Attendance, employees and all reports; stock read-only.",
  store_keeper: "Stock entry, items and the stock report.",
  staff: "Own attendance and payslips only.",
};

export type Access = "full" | "view" | "none";

export interface Area {
  key: string;
  label: string;
  module: "shared" | "stock" | "attendance" | "payroll" | "admin";
}

export const AREAS: readonly Area[] = [
  { key: "dashboard", label: "Dashboard", module: "shared" },
  { key: "stock_entry", label: "Stock entry", module: "stock" },
  { key: "items", label: "Items", module: "stock" },
  { key: "stock_report", label: "Stock report", module: "stock" },
  { key: "mark_attendance", label: "Mark attendance", module: "attendance" },
  { key: "attendance_report", label: "Attendance report", module: "attendance" },
  { key: "employees", label: "Employees", module: "payroll" },
  { key: "salary_report", label: "Salary report", module: "payroll" },
  { key: "admin", label: "Admin", module: "admin" },
];

export const PERMISSION_MATRIX: Record<Role, Record<string, Access>> = {
  admin: {
    dashboard: "full",
    stock_entry: "full",
    items: "full",
    stock_report: "full",
    mark_attendance: "full",
    attendance_report: "full",
    employees: "full",
    salary_report: "full",
    admin: "full",
  },
  manager: {
    dashboard: "full",
    stock_entry: "view",
    items: "view",
    stock_report: "full",
    mark_attendance: "full",
    attendance_report: "full",
    employees: "full",
    salary_report: "full",
    admin: "view",
  },
  store_keeper: {
    dashboard: "full",
    stock_entry: "full",
    items: "full",
    stock_report: "full",
    mark_attendance: "none",
    attendance_report: "none",
    employees: "none",
    salary_report: "none",
    admin: "none",
  },
  staff: {
    dashboard: "full",
    stock_entry: "none",
    items: "none",
    stock_report: "none",
    mark_attendance: "view",
    attendance_report: "view",
    employees: "none",
    salary_report: "view",
    admin: "none",
  },
};

export function accessFor(role: Role, areaKey: string): Access {
  return PERMISSION_MATRIX[role]?.[areaKey] ?? "none";
}

/** Symbol used in the matrix cells: ✓ / view / —. */
export function accessSymbol(access: Access): string {
  if (access === "full") return "✓";
  if (access === "view") return "view";
  return "—";
}

export function accessLabel(access: Access): string {
  if (access === "full") return "Full access";
  if (access === "view") return "View only";
  return "No access";
}

export type AdminPage = "users" | "org" | "settings" | "audit";

/**
 * Which admin pages a role may open. Admin: all. Manager: Branches &
 * departments, read-only. Everyone else: nothing.
 */
export function adminPageAccess(role: Role | null | undefined, page: AdminPage): Access {
  if (role === "admin") return "full";
  if (role === "manager" && page === "org") return "view";
  return "none";
}
