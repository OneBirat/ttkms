/**
 * Seed data for the mock admin API. BS dates come from web/lib/bs (the same calendar table as
 * app/core/bsdate.py); the anchor below only dates the sample rows (23 Oct 2026 = Kartik 6, 2083).
 */

import { bsToAd, isValidBs, kathmanduDateBs } from "@/lib/bs";
import type {
  AuditActor,
  AuditEntry,
  AuditModule,
  AuditValues,
  Branch,
  Department,
  EmployeeRef,
  Settings,
} from "../types";

// ---------------------------------------------------------------- dates

const ANCHOR_AD = Date.UTC(2026, 9, 23); // 2026-10-23

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** AD timestamp -> the Kathmandu BS day "YYYY-MM-DD" (the same table as the backend). */
export function approxBs(iso: string): string {
  return kathmanduDateBs(iso);
}

/** BS "YYYY-MM-DD" -> AD "YYYY-MM-DD" for the date filters; null when the date does not exist. */
export function approxAd(bs: string): string | null {
  return isValidBs(bs) ? bsToAd(bs) : null;
}

/** ISO timestamp `days` days before the anchor, at `time` Nepal time (UTC+5:45). */
function at(daysAgo: number, time = "10:00"): string {
  const [h, m] = time.split(":").map(Number);
  const utc = ANCHOR_AD - daysAgo * 24 * 60 * 60 * 1000 + ((h * 60 + m - 345) * 60 * 1000);
  return new Date(utc).toISOString();
}

// ------------------------------------------------------------------ org

export const BRANCHES: Branch[] = [
  { id: 1, name: "Main branch", is_active: true, employee_count: 0, active_employee_count: 0 },
  { id: 2, name: "Branch 2", is_active: true, employee_count: 0, active_employee_count: 0 },
];

export const DEPARTMENTS: Department[] = [
  { id: 1, name: "Store", is_active: true, employee_count: 0, active_employee_count: 0 },
  { id: 2, name: "Kitchen", is_active: true, employee_count: 0, active_employee_count: 0 },
  { id: 3, name: "Housekeeping", is_active: true, employee_count: 0, active_employee_count: 0 },
  { id: 4, name: "Front desk", is_active: true, employee_count: 0, active_employee_count: 0 },
  { id: 5, name: "Accounts", is_active: true, employee_count: 0, active_employee_count: 0 },
];

interface SeedEmployee {
  id: number;
  full_name: string;
  department_id: number;
  branch_id: number;
  designation: string;
  status?: "inactive";
}

const EMPLOYEE_SEED: SeedEmployee[] = [
  { id: 1, full_name: "Anita Gurung", department_id: 1, branch_id: 1, designation: "Store keeper" },
  { id: 2, full_name: "Ramesh K.C.", department_id: 1, branch_id: 1, designation: "Store helper", status: "inactive" },
  { id: 3, full_name: "Dipak Adhikari", department_id: 1, branch_id: 1, designation: "Store helper" },
  { id: 4, full_name: "Kamala Bhandari", department_id: 4, branch_id: 1, designation: "Cashier" },
  { id: 5, full_name: "Nabin Poudel", department_id: 1, branch_id: 1, designation: "Driver" },
  { id: 6, full_name: "Bikash Shrestha", department_id: 2, branch_id: 1, designation: "Head cook" },
  { id: 7, full_name: "Gita Magar", department_id: 2, branch_id: 1, designation: "Cook" },
  { id: 8, full_name: "Hari Bista", department_id: 2, branch_id: 1, designation: "Kitchen helper" },
  { id: 9, full_name: "Sarita Basnet", department_id: 5, branch_id: 1, designation: "Accountant" },
  { id: 10, full_name: "Pramila Shahi", department_id: 3, branch_id: 1, designation: "Housekeeping" },
  { id: 11, full_name: "Laxmi Tamang", department_id: 3, branch_id: 1, designation: "Housekeeping" },
  { id: 12, full_name: "Sunil Khadka", department_id: 4, branch_id: 1, designation: "Receptionist" },
  { id: 13, full_name: "Suman Rai", department_id: 1, branch_id: 2, designation: "Store keeper" },
  { id: 14, full_name: "Binita Limbu", department_id: 4, branch_id: 2, designation: "Cashier" },
  { id: 15, full_name: "Rajan Karki", department_id: 2, branch_id: 2, designation: "Cook" },
  { id: 16, full_name: "Sabina Shrestha", department_id: 3, branch_id: 2, designation: "Housekeeping" },
  { id: 17, full_name: "Mina Thapa", department_id: 5, branch_id: 2, designation: "Branch supervisor" },
  { id: 18, full_name: "Krishna Yadav", department_id: 1, branch_id: 2, designation: "Store helper" },
  { id: 19, full_name: "Sita Chaudhary", department_id: 2, branch_id: 1, designation: "Kitchen helper" },
  { id: 20, full_name: "Manoj Nepali", department_id: 3, branch_id: 1, designation: "Housekeeping", status: "inactive" },
  { id: 21, full_name: "Puja Maharjan", department_id: 5, branch_id: 1, designation: "Accounts assistant" },
  { id: 22, full_name: "Roshan Lama", department_id: 4, branch_id: 1, designation: "Receptionist" },
  { id: 23, full_name: "Asha Rana", department_id: 2, branch_id: 2, designation: "Kitchen helper" },
  { id: 24, full_name: "Tej Bahadur Gharti", department_id: 1, branch_id: 1, designation: "Driver" },
];

export const EMPLOYEES: EmployeeRef[] = EMPLOYEE_SEED.map((e) => ({
  id: e.id,
  code: `E-${pad(e.id).padStart(3, "0")}`,
  full_name: e.full_name,
  phone: null,
  department: DEPARTMENTS.find((d) => d.id === e.department_id)?.name ?? null,
  branch_id: e.branch_id,
  status: e.status ?? "active",
  user_id: null,
}));

export const EMPLOYEE_DEPARTMENT_IDS: Record<number, number> = Object.fromEntries(
  EMPLOYEE_SEED.map((e) => [e.id, e.department_id]),
);

// --------------------------------------------------------------- actors

/** Who appears as the actor of mock audit rows (the real log joins core.users). */
export const MOCK_ACTORS: AuditActor[] = [
  { id: 1, username: "admin", full_name: "Prakash Tamang" },
  { id: 2, username: "deepak.l", full_name: "Deepak Lama" },
  { id: 3, username: "sarita.b", full_name: "Sarita Basnet" },
  { id: 4, username: "mina.t", full_name: "Mina Thapa" },
  { id: 5, username: "anita.g", full_name: "Anita Gurung" },
  { id: 6, username: "suman.r", full_name: "Suman Rai" },
  { id: 7, username: "kamala.b", full_name: "Kamala Bhandari" },
  { id: 8, username: "bikash.s", full_name: "Bikash Shrestha" },
  { id: 9, username: "ramesh.k", full_name: "Ramesh K.C." },
];

// ------------------------------------------------------------- settings

function meta(user: string | null, daysAgo: number, time = "11:30") {
  const when = user ? at(daysAgo, time) : null;
  return { updated_by: user, updated_at: when, updated_at_bs: when ? approxBs(when) : null };
}

export const SETTINGS: Settings = {
  company: {
    name: "TTK Kitchen Appliances",
    address: "Teku Road, Kathmandu",
    phone: "01-4231123",
    pan_vat: "",
    logo_url: null,
  },
  attendance: {
    late_after: "09:30",
    weekly_off: ["sat"],
    half_day_note:
      "Arriving after 12:00 or leaving before 14:00 counts as a half day (½ day pay).",
  },
  payroll: { pay_day: 5, default_paid_by: "cash", rounding: "nearest_rupee" },
  display: { show_ad_dates: true, nepali_digits: false },
  meta: {
    company: meta("Prakash Tamang", 41),
    attendance: meta("Prakash Tamang", 120, "16:05"),
    payroll: meta("Deepak Lama", 28, "10:20"),
    display: meta("Prakash Tamang", 41),
  },
};

// ---------------------------------------------------------------- audit

type SeedAudit = [
  daysAgo: number,
  time: string,
  userId: number | null,
  module: AuditModule,
  action: string,
  entity: string,
  entityId: string | null,
  before: AuditValues | null,
  after: AuditValues | null,
];

const AUDIT_SEED: SeedAudit[] = [
  [0, "09:15", 1, "admin", "update", "settings", "payroll", { pay_day: 1 }, { pay_day: 5 }],
  [0, "08:55", 3, "attendance", "mark", "attendance", "2083-07-06", null, { present: 21, late: 2, absent: 1, leave: 0 }],
  [0, "08:52", 3, "attendance", "update", "attendance", "2083-07-06/E-008", { status: "absent" }, { status: "leave", note: "Sick leave" }],
  [1, "16:10", 1, "admin", "deactivate", "user", "9", { is_active: true }, { is_active: false }],
  [1, "16:08", 1, "admin", "update", "employee", "E-002", { status: "active" }, { status: "inactive" }],
  [2, "09:05", 3, "attendance", "mark", "attendance", "2083-07-04", null, { present: 22, late: 1, absent: 0, leave: 1 }],
  [3, "15:44", 2, "payroll", "pay", "salary", "2083-06/E-004", { status: "pending" }, { status: "paid", net: 18450, paid_by: "cash" }],
  [3, "15:40", 2, "payroll", "pay", "salary", "2083-06/E-001", { status: "pending" }, { status: "paid", net: 20697, paid_by: "bank" }],
  [3, "15:31", 2, "payroll", "advance", "advance", "A-18", null, { employee: "E-006", amount: 5000, recover_per_month: 2500 }],
  [4, "09:03", 3, "attendance", "mark", "attendance", "2083-07-02", null, { present: 23, late: 0, absent: 1, leave: 0 }],
  [5, "12:20", 1, "admin", "create", "user", "10", null, { username: "binita.l", role: "staff", employee: "E-014", branches: ["Branch 2"] }],
  [5, "12:15", 1, "admin", "create", "employee", "E-024", null, { full_name: "Tej Bahadur Gharti", department: "Store", branch: "Main branch" }],
  [7, "09:12", 3, "attendance", "mark", "attendance", "2083-06-30", null, { present: 20, late: 3, absent: 1, leave: 0 }],
  [8, "14:00", 2, "payroll", "revise", "salary_structure", "E-009", { basic: 25000 }, { basic: 27000, effective_from: "2083-07-01" }],
  [9, "11:30", 1, "admin", "reset_password", "user", "7", null, { username: "kamala.b" }],
  [12, "18:40", 2, "admin", "update", "settings", "payroll", { default_paid_by: "bank" }, { default_paid_by: "cash" }],
  [14, "09:00", 3, "attendance", "import", "biometric", "2083-06-22", null, { rows: 24, matched: 23, unmatched: 1 }],
  [15, "10:10", 1, "admin", "rename", "department", "4", { name: "Reception" }, { name: "Front desk" }],
  [21, "09:20", 3, "attendance", "update", "attendance", "2083-06-15/E-012", { status: "late" }, { status: "present", note: "Clock was wrong" }],
  [25, "16:02", 2, "payroll", "pay", "salary", "2083-05/E-013", { status: "pending" }, { status: "paid", net: 17200, paid_by: "cash" }],
  [28, "10:20", 2, "admin", "update", "settings", "payroll", { pay_day: 1, rounding: "none" }, { pay_day: 1, rounding: "nearest_rupee" }],
  [31, "11:11", 1, "admin", "update", "user", "4", { role: "staff", branches: ["Branch 2"] }, { role: "manager", branches: ["Branch 2"] }],
  [41, "11:30", 1, "admin", "update", "settings", "company", { address: "Teku, Kathmandu", phone: "" }, { address: "Teku Road, Kathmandu", phone: "01-4231123" }],
  [41, "11:28", 1, "admin", "update", "settings", "display", { show_ad_dates: false }, { show_ad_dates: true }],
  [44, "08:58", 3, "attendance", "mark", "attendance", "2083-05-23", null, { present: 22, late: 1, absent: 1, leave: 0 }],
  [50, "15:00", 2, "payroll", "advance", "advance", "A-17", null, { employee: "E-010", amount: 3000, recover_per_month: 1500 }],
  [58, "10:40", 1, "admin", "create", "branch", "2", null, { name: "Branch 2" }],
  [66, "09:30", 3, "attendance", "mark", "attendance", "2083-05-01", null, { present: 21, late: 2, absent: 0, leave: 1 }],
  [75, "17:20", null, "admin", "login_failed", "user", "admin", null, { attempts: 3, ip: "192.168.1.24" }],
  [80, "11:00", 1, "admin", "create", "user", "6", null, { username: "suman.r", role: "staff", employee: "E-013", branches: ["Branch 2"] }],
  [95, "08:10", 9, "attendance", "mark", "attendance", "2083-04-02", null, { present: 19, late: 1, absent: 2, leave: 0 }],
  [120, "16:05", 1, "admin", "update", "settings", "attendance", { late_after: "09:15", weekly_off: ["sat"] }, { late_after: "09:30", weekly_off: ["sat"] }],
  [140, "10:00", 2, "payroll", "pay", "salary", "2083-02/E-006", { status: "pending" }, { status: "paid", net: 24000, paid_by: "cash" }],
  [160, "09:00", 1, "admin", "create", "department", "5", null, { name: "Accounts" }],
  [190, "13:30", 1, "admin", "create", "user", "4", null, { username: "mina.t", role: "staff", employee: "E-017", branches: ["Branch 2"] }],
  [200, "10:15", 1, "admin", "create", "employee", "E-017", null, { full_name: "Mina Thapa", department: "Accounts", branch: "Branch 2" }],
];

export const AUDIT: AuditEntry[] = AUDIT_SEED.map((row, index) => {
  const [daysAgo, time, userId, module, action, entity, entityId, before, after] = row;
  const when = at(daysAgo, time);
  const user = userId ? (MOCK_ACTORS.find((u) => u.id === userId) ?? null) : null;
  return {
    id: 5000 - index,
    at: when,
    at_bs: approxBs(when),
    user: user ? { ...user } : null,
    module,
    action,
    entity,
    entity_id: entityId,
    before,
    after,
  };
});
