/**
 * Seed data for the mock admin API. Mock only: the real backend computes
 * BS dates with app/core/bsdate.py; `approxBs` here just keeps the sample
 * data plausible (2026-10-23 AD ~ 2083-07-06 BS) and must never ship.
 */

import type {
  AdminUser,
  AuditEntry,
  AuditModule,
  AuditValues,
  Branch,
  Department,
  EmployeeRef,
  Role,
  Settings,
} from "../types";
import { ROLE_LABELS } from "../permissions";

// ---------------------------------------------------------------- dates

const ANCHOR_AD = Date.UTC(2026, 9, 23); // 2026-10-23
const ANCHOR_BS = { year: 2083, month: 7, day: 6 };
// Approximate month lengths, reused for every year (mock only).
const BS_MONTH_DAYS = [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Mock-only AD -> BS ("YYYY-MM-DD") by day offset from the anchor. */
export function approxBs(iso: string): string {
  const ad = new Date(iso);
  const dayMs = 24 * 60 * 60 * 1000;
  let offset = Math.floor(
    (Date.UTC(ad.getUTCFullYear(), ad.getUTCMonth(), ad.getUTCDate()) - ANCHOR_AD) / dayMs,
  );
  let { year, month, day } = ANCHOR_BS;
  while (offset > 0) {
    const len = BS_MONTH_DAYS[month - 1];
    if (day + offset <= len) {
      day += offset;
      offset = 0;
    } else {
      offset -= len - day + 1;
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  while (offset < 0) {
    if (day + offset >= 1) {
      day += offset;
      offset = 0;
    } else {
      offset += day;
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = BS_MONTH_DAYS[month - 1];
    }
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Mock-only BS "YYYY-MM-DD" -> approximate AD ISO date (for date filters). */
export function approxAd(bs: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bs.trim());
  if (!match) return null;
  const target = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (target.month < 1 || target.month > 12 || target.day < 1 || target.day > 32) return null;
  const toOrdinal = (d: { year: number; month: number; day: number }) => {
    let days = d.year * 365;
    for (let m = 1; m < d.month; m += 1) days += BS_MONTH_DAYS[m - 1];
    return days + d.day;
  };
  const offset = toOrdinal(target) - toOrdinal(ANCHOR_BS);
  const date = new Date(ANCHOR_AD + offset * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
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
  department: DEPARTMENTS.find((d) => d.id === e.department_id)?.name ?? null,
  branch_id: e.branch_id,
  status: e.status ?? "active",
}));

export const EMPLOYEE_DEPARTMENT_IDS: Record<number, number> = Object.fromEntries(
  EMPLOYEE_SEED.map((e) => [e.id, e.department_id]),
);

// ---------------------------------------------------------------- users

interface SeedUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active?: boolean;
  employee_id?: number;
  branch_ids?: number[];
  last_login?: [number, string] | null;
  created_days_ago: number;
}

const USER_SEED: SeedUser[] = [
  { id: 1, username: "admin", full_name: "Prakash Tamang", role: "admin", last_login: [0, "09:14"], created_days_ago: 400 },
  { id: 2, username: "deepak.l", full_name: "Deepak Lama", role: "admin", last_login: [12, "18:40"], created_days_ago: 380 },
  { id: 3, username: "sarita.b", full_name: "Sarita Basnet", role: "manager", employee_id: 9, last_login: [0, "08:52"], created_days_ago: 360 },
  { id: 4, username: "mina.t", full_name: "Mina Thapa", role: "manager", employee_id: 17, branch_ids: [2], last_login: [1, "17:05"], created_days_ago: 200 },
  { id: 5, username: "anita.g", full_name: "Anita Gurung", role: "staff", employee_id: 1, branch_ids: [1], last_login: [0, "09:31"], created_days_ago: 350 },
  { id: 6, username: "suman.r", full_name: "Suman Rai", role: "staff", employee_id: 13, branch_ids: [2], last_login: [2, "10:12"], created_days_ago: 190 },
  { id: 7, username: "kamala.b", full_name: "Kamala Bhandari", role: "staff", employee_id: 4, branch_ids: [1], last_login: [5, "13:20"], created_days_ago: 300 },
  { id: 8, username: "bikash.s", full_name: "Bikash Shrestha", role: "staff", employee_id: 6, branch_ids: [1], last_login: [3, "07:58"], created_days_ago: 300 },
  { id: 9, username: "ramesh.k", full_name: "Ramesh K.C.", role: "staff", employee_id: 2, branch_ids: [1], is_active: false, last_login: [95, "08:10"], created_days_ago: 320 },
  { id: 10, username: "binita.l", full_name: "Binita Limbu", role: "staff", employee_id: 14, branch_ids: [2], last_login: null, created_days_ago: 9 },
];

export const USERS: AdminUser[] = USER_SEED.map((u) => {
  const lastLogin = u.last_login ? at(u.last_login[0], u.last_login[1]) : null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    role_label: ROLE_LABELS[u.role],
    is_active: u.is_active ?? true,
    employee: EMPLOYEES.find((e) => e.id === u.employee_id) ?? null,
    branch_ids: u.branch_ids ?? [],
    last_login_at: lastLogin,
    last_login_at_bs: lastLogin ? approxBs(lastLogin) : null,
    created_at: at(u.created_days_ago, "11:00"),
  };
});

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
  stock: { default_reorder_level: 5, default_unit: "pcs" },
  display: { show_ad_dates: true, nepali_digits: false },
  meta: {
    company: meta("Prakash Tamang", 41),
    attendance: meta("Prakash Tamang", 120, "16:05"),
    payroll: meta("Deepak Lama", 28, "10:20"),
    stock: meta(null, 0),
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
  [0, "09:41", 5, "stock", "create", "movement", "M-1042", null, { item: "SS Black cooker 3 L", type: "in", qty: 12, note: "Purchase, Bhatbhateni" }],
  [0, "09:15", 1, "admin", "update", "settings", "payroll", { pay_day: 1 }, { pay_day: 5 }],
  [0, "08:55", 3, "attendance", "mark", "attendance", "2083-07-06", null, { present: 21, late: 2, absent: 1, leave: 0 }],
  [0, "08:52", 3, "attendance", "update", "attendance", "2083-07-06/E-008", { status: "absent" }, { status: "leave", note: "Sick leave" }],
  [1, "17:30", 4, "stock", "create", "movement", "M-1041", null, { item: "Rice cooker 1.8 L", type: "out", qty: 3, branch: "Branch 2" }],
  [1, "16:10", 1, "admin", "deactivate", "user", "9", { is_active: true }, { is_active: false }],
  [1, "16:08", 1, "admin", "update", "employee", "E-002", { status: "active" }, { status: "inactive" }],
  [1, "11:02", 5, "stock", "update", "item", "SSBC-3L", { reorder_level: 4 }, { reorder_level: 6 }],
  [2, "10:12", 6, "stock", "create", "movement", "M-1040", null, { item: "Glass top gas stove 2 burner", type: "in", qty: 6, branch: "Branch 2" }],
  [2, "09:05", 3, "attendance", "mark", "attendance", "2083-07-04", null, { present: 22, late: 1, absent: 0, leave: 1 }],
  [3, "15:44", 2, "payroll", "pay", "salary", "2083-06/E-004", { status: "pending" }, { status: "paid", net: 18450, paid_by: "cash" }],
  [3, "15:40", 2, "payroll", "pay", "salary", "2083-06/E-001", { status: "pending" }, { status: "paid", net: 20697, paid_by: "bank" }],
  [3, "15:31", 2, "payroll", "advance", "advance", "A-18", null, { employee: "E-006", amount: 5000, recover_per_month: 2500 }],
  [4, "09:03", 3, "attendance", "mark", "attendance", "2083-07-02", null, { present: 23, late: 0, absent: 1, leave: 0 }],
  [5, "12:20", 1, "admin", "create", "user", "10", null, { username: "binita.l", role: "staff", employee: "E-014", branches: ["Branch 2"] }],
  [5, "12:15", 1, "admin", "create", "employee", "E-024", null, { full_name: "Tej Bahadur Gharti", department: "Store", branch: "Main branch" }],
  [6, "10:50", 5, "stock", "create", "item", "NSFP-28", null, { product: "Non-stick fry pan", variation: "28 cm", reorder_level: 5 }],
  [7, "09:12", 3, "attendance", "mark", "attendance", "2083-06-30", null, { present: 20, late: 3, absent: 1, leave: 0 }],
  [8, "14:00", 2, "payroll", "revise", "salary_structure", "E-009", { basic: 25000 }, { basic: 27000, effective_from: "2083-07-01" }],
  [9, "11:30", 1, "admin", "reset_password", "user", "7", null, { username: "kamala.b" }],
  [10, "16:45", 4, "stock", "create", "movement", "M-1012", null, { item: "Electric kettle 1.5 L", type: "out", qty: 2, branch: "Branch 2" }],
  [12, "18:40", 2, "admin", "update", "settings", "payroll", { default_paid_by: "bank" }, { default_paid_by: "cash" }],
  [14, "09:00", 3, "attendance", "import", "biometric", "2083-06-22", null, { rows: 24, matched: 23, unmatched: 1 }],
  [15, "10:10", 1, "admin", "rename", "department", "4", { name: "Reception" }, { name: "Front desk" }],
  [18, "13:25", 5, "stock", "update", "movement", "M-0988", { qty: 5 }, { qty: 4, note: "Counting error" }],
  [21, "09:20", 3, "attendance", "update", "attendance", "2083-06-15/E-012", { status: "late" }, { status: "present", note: "Clock was wrong" }],
  [25, "16:02", 2, "payroll", "pay", "salary", "2083-05/E-013", { status: "pending" }, { status: "paid", net: 17200, paid_by: "cash" }],
  [28, "10:20", 2, "admin", "update", "settings", "payroll", { pay_day: 1, rounding: "none" }, { pay_day: 1, rounding: "nearest_rupee" }],
  [31, "11:11", 1, "admin", "update", "user", "4", { role: "staff", branches: ["Branch 2"] }, { role: "manager", branches: ["Branch 2"] }],
  [35, "09:48", 6, "stock", "create", "movement", "M-0901", null, { item: "Steel kadhai 26 cm", type: "in", qty: 10, branch: "Branch 2" }],
  [41, "11:30", 1, "admin", "update", "settings", "company", { address: "Teku, Kathmandu", phone: "" }, { address: "Teku Road, Kathmandu", phone: "01-4231123" }],
  [41, "11:28", 1, "admin", "update", "settings", "display", { show_ad_dates: false }, { show_ad_dates: true }],
  [44, "08:58", 3, "attendance", "mark", "attendance", "2083-05-23", null, { present: 22, late: 1, absent: 1, leave: 0 }],
  [50, "15:00", 2, "payroll", "advance", "advance", "A-17", null, { employee: "E-010", amount: 3000, recover_per_month: 1500 }],
  [58, "10:40", 1, "admin", "create", "branch", "2", null, { name: "Branch 2" }],
  [60, "12:05", 5, "stock", "update", "item", "RC-1.8L", { reorder_level: 5 }, { reorder_level: 8 }],
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
  const user = userId ? USERS.find((u) => u.id === userId) ?? null : null;
  return {
    id: 5000 - index,
    at: when,
    at_bs: approxBs(when),
    user: user ? { id: user.id, username: user.username, full_name: user.full_name } : null,
    module,
    action,
    entity,
    entity_id: entityId,
    before,
    after,
  };
});
