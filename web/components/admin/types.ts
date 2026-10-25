/**
 * Admin module contract.
 *
 * Users, payment modes and barcodes talk to the real FastAPI endpoints under
 * /api/admin (shapes mirrored from app/modules/admin/schemas.py). Branches &
 * departments, Settings and the Audit log still run on the mock in ./api.ts
 * until their endpoints exist.
 *
 * Dates: timestamps come as ISO 8601 AD (`*_at`) plus the server-computed
 * Bikram Sambat "YYYY-MM-DD" (`*_at_bs`, null while the BS table is not
 * installed). BS is shown first, AD is secondary.
 */

import type { Role } from "@/lib/api";

export type { Role };

export const ROLES: readonly Role[] = ["admin", "manager", "staff"];

// ------------------------------------------------------------------ users

export type PermissionKey =
  | "mark_attendance"
  | "view_attendance_report"
  | "see_other_branches"
  | "manage_employees"
  | "salary_advances"
  | "manage_users";

/** Effective permissions: every key present. */
export type Access = Record<PermissionKey, boolean>;

export interface BranchRef {
  id: number;
  name: string;
  is_active: boolean;
}

export interface EmployeeRef {
  id: number;
  code: string;
  full_name: string;
  phone: string | null;
  department: string | null;
  branch_id: number;
  status: "active" | "inactive";
  /** The user this employee is already linked to, if any. */
  user_id: number | null;
}

export interface AdminUser {
  id: number;
  full_name: string;
  /** Login phone (10 digits) or null for accounts that sign in by username only. */
  phone: string | null;
  username: string;
  role: Role;
  role_label: string;
  is_active: boolean;
  /** The signed-in admin's own row. */
  is_you: boolean;
  must_change_password: boolean;
  /** null = all branches (always for admins). */
  branch: BranchRef | null;
  employee: EmployeeRef | null;
  last_login_at: string | null;
  last_login_at_bs: string | null;
  access: Access;
  /** True when `access` differs from the role preset ("Custom"). */
  custom: boolean;
}

export interface UserInput {
  full_name: string;
  phone: string;
  role: Role;
  branch_id: number | null;
  employee_id: number | null;
  /** null = use the role preset. */
  access: Access | null;
}

export interface UserCreated {
  user: AdminUser;
  /** Shown once; the user must replace it at first sign-in. */
  temporary_password: string;
}

export interface TemporaryPassword {
  user_id: number;
  full_name: string;
  temporary_password: string;
}

export interface UserOptions {
  branches: BranchRef[];
  employees: EmployeeRef[];
}

// ---------------------------------------------------- branches & departments

export interface Branch {
  id: number;
  name: string;
  is_active: boolean;
  employee_count: number;
  active_employee_count: number;
}

export interface Department {
  id: number;
  name: string;
  is_active: boolean;
  employee_count: number;
  active_employee_count: number;
}

export type OrgKind = "branch" | "department";

// --------------------------------------------------------------- settings

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const WEEKDAYS: readonly { value: Weekday; label: string; np: string }[] = [
  { value: "sun", label: "Sunday", np: "आ" },
  { value: "mon", label: "Monday", np: "सो" },
  { value: "tue", label: "Tuesday", np: "मं" },
  { value: "wed", label: "Wednesday", np: "बु" },
  { value: "thu", label: "Thursday", np: "बि" },
  { value: "fri", label: "Friday", np: "शु" },
  { value: "sat", label: "Saturday", np: "श" },
];

export type PaidBy = "cash" | "bank";
export type Rounding = "nearest_rupee" | "none";

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  /** PAN or VAT registration number; optional. */
  pan_vat: string;
  /** URL of the uploaded logo (used on PDF headers); null when none. */
  logo_url: string | null;
}

export interface AttendanceSettings {
  /** "HH:MM", 24-hour. */
  late_after: string;
  weekly_off: Weekday[];
  half_day_note: string;
}

export interface PayrollSettings {
  /** BS day of month, 1–32. */
  pay_day: number;
  default_paid_by: PaidBy;
  rounding: Rounding;
}

export interface DisplaySettings {
  show_ad_dates: boolean;
  nepali_digits: boolean;
}

export type SettingsGroup = "company" | "attendance" | "payroll" | "display";

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  "company",
  "attendance",
  "payroll",
  "display",
];

export interface SettingsMeta {
  updated_by: string | null;
  updated_at: string | null;
  updated_at_bs: string | null;
}

export interface Settings {
  company: CompanySettings;
  attendance: AttendanceSettings;
  payroll: PayrollSettings;
  display: DisplaySettings;
  meta: Record<SettingsGroup, SettingsMeta>;
}

/** What PUT /api/admin/settings accepts: everything but `meta` and the logo. */
export type SettingsInput = Omit<Settings, "meta" | "company"> & {
  company: Omit<CompanySettings, "logo_url">;
};

// ------------------------------------------------------------------ audit

export type AuditModule = "attendance" | "payroll" | "admin";

export const AUDIT_MODULES: readonly { value: AuditModule; label: string }[] = [
  { value: "attendance", label: "Attendance" },
  { value: "payroll", label: "Payroll" },
  { value: "admin", label: "Admin" },
];

export interface AuditActor {
  id: number;
  username: string;
  full_name: string;
}

export type AuditValues = Record<string, unknown>;

export interface AuditEntry {
  id: number;
  at: string;
  at_bs: string;
  user: AuditActor | null;
  module: AuditModule;
  action: string;
  entity: string;
  entity_id: string | null;
  before: AuditValues | null;
  after: AuditValues | null;
}

export interface AuditListParams {
  /** BS dates, "YYYY-MM-DD", inclusive. */
  from_bs?: string;
  to_bs?: string;
  module?: AuditModule | "";
  user_id?: number | null;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// ---------------------------------------------------------- payment modes

export type PaymentModeType = "cash" | "bank" | "wallet" | "qr" | "cheque";
export type EditableModeType = Exclude<PaymentModeType, "cash">;

/** One row of GET /api/admin/payment-modes (Cash first, then creation order). */
export interface PaymentMode {
  id: number;
  type: PaymentModeType;
  name: string;
  /** "A/c ··4410", wallet number, QR label; null for Cash. */
  details: string | null;
  use_salary: boolean;
  use_advance: boolean;
  active: boolean;
  /** Cash: cannot be edited or turned off. */
  is_builtin: boolean;
  /** Payments recorded with this mode (0 until payroll records payments). */
  payment_count: number;
  created_at: string;
}

export interface PaymentModeInput {
  type: EditableModeType;
  name: string;
  details: string | null;
  use_salary: boolean;
  use_advance: boolean;
}

// --------------------------------------------------------------- barcodes

export interface BarcodeEmployee {
  id: number;
  code: string;
  full_name: string;
  department: string | null;
  designation: string | null;
  branch_id: number;
  branch: string;
  /** What the sticker encodes: core.employees.barcode, "TTK-E001". */
  barcode: string;
}

export interface StickerSize {
  key: string;
  label: string;
  columns: number;
  rows: number;
  per_page: number;
}

export interface BarcodesResponse {
  employees: BarcodeEmployee[];
  sizes: StickerSize[];
  /** False while the server cannot render PDFs (print from the browser instead). */
  pdf_available: boolean;
}
