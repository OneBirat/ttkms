/**
 * Admin module contract: the shapes the future FastAPI endpoints under
 * /api/admin will return. Pages only ever see these types through api.ts.
 *
 * Dates: every timestamp comes twice, as ISO 8601 AD (`*_at`) and as the
 * server-computed Bikram Sambat string "YYYY-MM-DD" (`*_at_bs`). BS is shown
 * first everywhere, AD is secondary.
 */

import type { Role } from "@/lib/api";

export type { Role };

export const ROLES: readonly Role[] = ["admin", "manager", "store_keeper", "staff"];

export interface EmployeeRef {
  id: number;
  code: string;
  full_name: string;
  department: string | null;
  branch_id: number;
  status: "active" | "inactive";
}

export interface AdminUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  role_label: string;
  is_active: boolean;
  employee: EmployeeRef | null;
  /** Empty list = access to all branches. */
  branch_ids: number[];
  last_login_at: string | null;
  last_login_at_bs: string | null;
  created_at: string;
}

export interface UserInput {
  full_name: string;
  username: string;
  role: Role;
  employee_id: number | null;
  branch_ids: number[];
  is_active: boolean;
}

/** Returned once, on create and on reset password. Never stored client-side. */
export interface OneTimePassword {
  user_id: number;
  username: string;
  password: string;
}

export interface UserCreated {
  user: AdminUser;
  one_time_password: OneTimePassword;
}

export type UserStatusFilter = "active" | "inactive" | "all";

export interface UserListParams {
  q?: string;
  role?: Role | "";
  status?: UserStatusFilter;
}

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

export interface StockSettings {
  default_reorder_level: number;
  default_unit: string;
}

export interface DisplaySettings {
  show_ad_dates: boolean;
  nepali_digits: boolean;
}

export type SettingsGroup = "company" | "attendance" | "payroll" | "stock" | "display";

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  "company",
  "attendance",
  "payroll",
  "stock",
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
  stock: StockSettings;
  display: DisplaySettings;
  meta: Record<SettingsGroup, SettingsMeta>;
}

/** What PUT /api/admin/settings accepts: everything but `meta` and the logo. */
export type SettingsInput = Omit<Settings, "meta" | "company"> & {
  company: Omit<CompanySettings, "logo_url">;
};

export type AuditModule = "stock" | "attendance" | "payroll" | "admin";

export const AUDIT_MODULES: readonly { value: AuditModule; label: string }[] = [
  { value: "stock", label: "Stock" },
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
