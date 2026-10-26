/**
 * Seed for the in-memory People & payroll mock (api.ts). Attendance figures
 * and the payments of past months are generated deterministically from the
 * same calc.ts the screens use, relative to today's BS month, so every number
 * on the screens follows the decided rules. Replaced by the backend after
 * UI sign-off.
 */

import type { Role } from "@/lib/api";
import { dailyPay, defaultOtRate, monthlyPay, roundRs, settle } from "./calc";
import { adToBs, isoBs, monthDays } from "@/lib/bs";
import { addMonths, dateBoth, daysInMonth, monthKey, monthName, thisMonth, today } from "./months";
import { transliterateName } from "./devanagari";
import { barcodeFor, employeeCode, receiptNo } from "./helpers";
import type {
  Branch,
  BsMonth,
  Department,
  Employee,
  MonthSummary,

  Payment,
  PaymentMode,
  PayType,
  SalaryStructure,
  TodayStatus,
} from "../types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

/** Who the mock records payments as (the backend uses the session user). */
export const MOCK_USER = "admin";

/** How many months the mock keeps (current month included). */
export const MONTHS_KEPT = 6;

/** How the seed rows say a person is paid; mapped to payment-mode ids below. */
type PaidBy = "cash" | "bank";

export interface MockPhotoToken {
  token: string;
  employee_id: number;
  expires_at: string;
}

export interface MockState {
  /** Month the seed was built for; a new month reseeds. */
  seeded_for: string;
  branches: Branch[];
  departments: Department[];
  /** Read-only here: admin owns the CRUD (GET /api/admin/payment-modes). */
  payment_modes: PaymentMode[];
  employees: Employee[];
  structures: SalaryStructure[];
  payments: Payment[];
  photo_tokens: MockPhotoToken[];
  next_id: Record<string, number>;
}

export const BRANCHES: Branch[] = [
  { id: 1, name: "Main branch", is_active: true },
  { id: 2, name: "Branch 2", is_active: true },
];

/**
 * Sample of GET /api/admin/payment-modes (NEEDS FROM TTK-ADMIN). Cash is
 * built in and always on; Cheque is switched off to show the filter.
 */
export const PAYMENT_MODES: PaymentMode[] = [
  { id: 1, type: "cash", name: "Cash", details: null, use_salary: true, use_advance: true, active: true },
  { id: 2, type: "bank", name: "NIC Asia Bank", details: "A/c ··4410", use_salary: true, use_advance: true, active: true },
  { id: 3, type: "wallet", name: "eSewa", details: "98XXXXXX01", use_salary: true, use_advance: true, active: true },
  { id: 4, type: "wallet", name: "Khalti", details: "98XXXXXX01", use_salary: false, use_advance: true, active: true },
  { id: 5, type: "qr", name: "Fonepay QR", details: "Shop QR · NIC Asia", use_salary: true, use_advance: true, active: true },
  { id: 6, type: "cheque", name: "Cheque", details: "NIC Asia cheque book", use_salary: true, use_advance: false, active: false },
];

export const CASH_MODE_ID = 1;
export const BANK_MODE_ID = 2;

export function modeRef(mode: PaymentMode): Payment["payment_mode"] {
  return { id: mode.id, type: mode.type, name: mode.name };
}

/** Seed copy of core.departments (ids match `make seed`); listDepartments() replaces it with the real rows. */
export const DEPARTMENTS: Department[] = [
  { id: 1, name: "Store", employee_count: 0, active_employee_count: 0 },
  { id: 2, name: "Kitchen", employee_count: 0, active_employee_count: 0 },
  { id: 3, name: "Housekeeping", employee_count: 0, active_employee_count: 0 },
  { id: 4, name: "Front desk", employee_count: 0, active_employee_count: 0 },
  { id: 5, name: "Accounts", employee_count: 0, active_employee_count: 0 },
];

type Seed = [
  name: string,
  designation: string,
  department: number,
  branch: number,
  pay: PayType,
  amount: number,
  paid_by: PaidBy,
  phone: string,
  address: string,
  joined_bs: string,
  phone_alt?: string,
  previous?: number,
];

/** 25 staff, codes E-001… in this order (17 monthly, 8 daily wage). */
const SEED: Seed[] = [
  ["Anita Gurung", "Store keeper", 1, 1, "monthly", 22000, "bank", "9841 203 311", "Balaju, Kathmandu", "2078-02-15", "9803 112 540", 20000],
  ["Ramesh K.C.", "Store helper", 1, 1, "daily", 650, "cash", "9808 554 120", "Gongabu, Kathmandu", "2080-04-01"],
  ["Sunita Tamang", "Store helper", 1, 1, "daily", 650, "cash", "9818 220 087", "Tokha, Kathmandu", "2081-01-10"],
  ["Bikash Shrestha", "Senior cook", 2, 1, "monthly", 32000, "bank", "9851 044 901", "Kirtipur, Kathmandu", "2077-09-01", "9841 882 013", 30000],
  ["Mina Rai", "Cook", 2, 1, "monthly", 24000, "bank", "9860 118 334", "Imadol, Lalitpur", "2079-06-20"],
  ["Dipak Lama", "Kitchen helper", 2, 1, "daily", 700, "cash", "9823 405 661", "Boudha, Kathmandu", "2081-08-12"],
  ["Sabina Magar", "Kitchen helper", 2, 1, "daily", 700, "cash", "9845 770 219", "Chabahil, Kathmandu", "2082-02-03"],
  ["Prakash Thapa", "Cook", 2, 2, "monthly", 23000, "cash", "9812 931 450", "Suryabinayak, Bhaktapur", "2080-11-05", undefined, 21000],
  ["Laxmi Karki", "Housekeeper", 3, 1, "monthly", 18000, "cash", "9867 332 108", "Kalanki, Kathmandu", "2079-03-14"],
  ["Gita Pariyar", "Cleaner", 3, 1, "daily", 600, "cash", "9849 010 775", "Swayambhu, Kathmandu", "2081-05-22"],
  ["Hari Bahadur Bk", "Cleaner", 3, 1, "daily", 600, "cash", "9803 660 442", "Thankot, Kathmandu", "2082-07-01"],
  ["Kamala Adhikari", "Housekeeper", 3, 2, "monthly", 18000, "cash", "9861 557 203", "Sallaghari, Bhaktapur", "2080-01-18"],
  ["Suresh Maharjan", "Front desk", 4, 1, "monthly", 25000, "bank", "9851 206 118", "Kupondole, Lalitpur", "2078-10-02", "9841 008 331"],
  ["Pooja Basnet", "Front desk", 4, 1, "monthly", 24000, "bank", "9818 775 902", "Baneshwor, Kathmandu", "2081-03-09"],
  ["Nabin Chaudhary", "Front desk", 4, 2, "monthly", 23000, "bank", "9845 330 607", "Jagati, Bhaktapur", "2082-01-25"],
  ["Sarita Basnet", "Accountant", 5, 1, "monthly", 35000, "bank", "9841 999 120", "Sanepa, Lalitpur", "2077-04-01", "9801 234 567", 32000],
  ["Rajan Poudel", "Accounts assistant", 5, 1, "monthly", 26000, "bank", "9860 442 319", "Koteshwor, Kathmandu", "2080-07-16"],
  ["Binod Gurung", "Store keeper", 1, 2, "monthly", 21000, "bank", "9808 113 905", "Thimi, Bhaktapur", "2080-02-01"],
  ["Rita Shrestha", "Store helper", 1, 2, "daily", 650, "cash", "9823 778 440", "Katunje, Bhaktapur", "2082-04-10"],
  ["Manoj Tamang", "Cook", 2, 2, "monthly", 24000, "bank", "9818 006 273", "Lokanthali, Bhaktapur", "2079-12-01"],
  ["Sita Lama", "Kitchen helper", 2, 2, "daily", 700, "cash", "9849 553 118", "Gatthaghar, Bhaktapur", "2081-10-20"],
  ["Deepa Rai", "Housekeeper", 3, 2, "monthly", 18000, "cash", "9867 201 554", "Sano Thimi, Bhaktapur", "2081-06-02"],
  ["Krishna Khadka", "Guard", 4, 1, "monthly", 19000, "cash", "9851 880 219", "Budhanilkantha, Kathmandu", "2078-08-11", "9841 557 002"],
  ["Anjali Shahi", "Cashier", 5, 2, "monthly", 24000, "bank", "9841 330 018", "Dadhikot, Bhaktapur", "2082-09-15"],
  ["Tek Bahadur Magar", "Guard", 4, 2, "monthly", 19000, "cash", "9808 229 667", "Nagarkot road, Bhaktapur", "2080-05-30"],
];

/** Logins for a few staff (core.users): id → username + role. */
const LOGINS: Record<number, { username: string; role: Role }> = {
  1: { username: "anita.g", role: "staff" },
  4: { username: "bikash.s", role: "manager" },
  16: { username: "sarita.b", role: "admin" },
  18: { username: "binod.g", role: "staff" },
};

// ------------------------------------------------------------ attendance

/**
 * Deterministic MonthSummary, the shape AttendanceSummary.for_month returns
 * (same spirit as app/contracts.py FakeAttendanceSummary, with the new
 * P / O / A statuses). The running month counts days up to today.
 */
export function mockAttendance(employee_id: number, month: BsMonth, now: Date = new Date()): MonthSummary {
  const days = daysInMonth(month);
  const current = thisMonth(now);
  const index = (m: BsMonth) => m.bs_year * 12 + m.bs_month;
  let upTo = days;
  if (index(month) > index(current)) upTo = 0;
  else if (index(month) === index(current)) upTo = adToBs(today(now).ad).day;
  const weekly_off = upTo > 0 ? monthDays(month.bs_year, month.bs_month).slice(0, upTo).filter((d) => d.weekday === 6).length : 0;
  const working = Math.max(0, upTo - weekly_off);
  const seed = (employee_id * 31 + month.bs_year * 12 + month.bs_month) % 7;
  const absent = Math.min(working, seed % 3);
  const overtime_days = weekly_off > 0 && (seed + employee_id) % 4 === 0 ? 1 : 0;
  const overtime_hours = working > 0 ? ((seed * employee_id) % 3) * 2 + overtime_days * 4 : 0;
  const present = working - absent;
  return {
    days_in_month: days,
    present,
    overtime_days,
    overtime_hours,
    absent,
    weekly_off,
    paid_days: Math.max(0, upTo - absent),
  };
}

/**
 * Today's mark for one employee, the shape GET /api/attendance/today will
 * return per employee (NEEDS FROM TTK-ATTENDANCE). Saturday is the weekly
 * off; otherwise a deterministic spread of P / O / A / not marked.
 */
export function todayStatusFor(employee_id: number, now: Date = new Date()): TodayStatus {
  const ad = today(now).ad;
  const [y, m, d] = ad.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6) return "weekly_off";
  const h = (employee_id * 37 + d * 11) % 10;
  return h < 6 ? "present" : h < 8 ? "overtime" : h < 9 ? "absent" : "not_marked";
}

// --------------------------------------------------------------- helpers

/** The structure in force for a month: latest effective on or before the month's last day. */
export function structureFor(
  structures: SalaryStructure[],
  employee_id: number,
  month: BsMonth,
): SalaryStructure | null {
  const limit = isoBs(month.bs_year, month.bs_month, 32);
  const mine = structures
    .filter((s) => s.employee_id === employee_id)
    .sort((a, b) => b.effective_from.bs.localeCompare(a.effective_from.bs) || b.id - a.id);
  return mine.find((s) => s.effective_from.bs <= limit) ?? mine[mine.length - 1] ?? null;
}

export function monthsKept(now: Date = new Date()): BsMonth[] {
  const current = thisMonth(now);
  const months: BsMonth[] = [];
  for (let k = MONTHS_KEPT - 1; k >= 0; k -= 1) months.push(addMonths(current, -k));
  return months;
}

function id(next: Record<string, number>, kind: string): number {
  const value = next[kind] ?? 1;
  next[kind] = value + 1;
  return value;
}

function bankRef(employee_id: number, month: BsMonth): string {
  return `NBL-${month.bs_year}${String(month.bs_month).padStart(2, "0")}-${String(employee_id * 37 % 1000).padStart(3, "0")}`;
}

// ------------------------------------------------------------------ seed

export function buildSeedState(now: Date = new Date()): MockState {
  const next: Record<string, number> = {};
  const todayBoth = today(now);
  const current = thisMonth(now);
  const todayDay = adToBs(todayBoth.ad).day;
  const months = monthsKept(now);
  const employees: Employee[] = [];
  const structures: SalaryStructure[] = [];
  const payments: Payment[] = [];

  SEED.forEach((row, index) => {
    const [name, designation, department, branch, pay, amount, paid_by, phone, address, joined_bs, phone_alt, previous] = row;
    const employee_id = index + 1;
    id(next, "employee");
    const login = LOGINS[employee_id];
    employees.push({
      id: employee_id,
      code: employeeCode(employee_id),
      barcode: barcodeFor(employeeCode(employee_id)),
      full_name: name,
      full_name_np: transliterateName(name),
      phone,
      phone_alt: phone_alt ?? null,
      address,
      branch: BRANCHES.find((b) => b.id === branch)!,
      department: DEPARTMENTS.find((d) => d.id === department)!,
      designation,
      active: true,
      joined: dateBoth(joined_bs),
      photo_url: null,
      login: login
        ? { user_id: id(next, "user"), username: login.username, role: login.role, role_label: ROLE_LABELS[login.role] }
        : null,
      created_at: joined_bs,
    });

    const revision = isoBs(current.bs_year, 3, 1) <= todayBoth.bs ? isoBs(current.bs_year, 3, 1) : isoBs(current.bs_year - 1, 3, 1);
    if (previous !== undefined) {
      structures.push({
        id: id(next, "structure"),
        employee_id,
        pay_type: pay,
        basic: previous,
        allowances: 0,
        gross: previous,
        ot_rate: defaultOtRate(pay, previous),
        default_payment_mode_id: paid_by === "bank" ? BANK_MODE_ID : CASH_MODE_ID,
        default_payment_mode: modeRef(PAYMENT_MODES.find((pm) => pm.id === (paid_by === "bank" ? BANK_MODE_ID : CASH_MODE_ID))!),
        effective_from: dateBoth(joined_bs),
        reason: null,
        previous_gross: null,
      });
    }
    const allowances = pay === "monthly" && employee_id % 5 === 0 ? 2000 : 0;
    structures.push({
      id: id(next, "structure"),
      employee_id,
      pay_type: pay,
      basic: amount - allowances,
      allowances,
      gross: amount,
      ot_rate: defaultOtRate(pay, amount),
      default_payment_mode_id: paid_by === "bank" ? BANK_MODE_ID : CASH_MODE_ID,
      default_payment_mode: modeRef(PAYMENT_MODES.find((pm) => pm.id === (paid_by === "bank" ? BANK_MODE_ID : CASH_MODE_ID))!),
      effective_from: dateBoth(previous !== undefined ? revision : joined_bs),
      reason: previous !== undefined ? "Annual increment" : null,
      previous_gross: previous ?? null,
    });
  });

  // Payments of past months, then the running month.
  const addPayment = (p: Omit<Payment, "id" | "receipt_no" | "created_at" | "paid_at" | "recorded_by" | "source">) => {
    const payment_id = id(next, "payment");
    const at = `${p.date.ad}T10:${String(10 + (p.employee_id % 45)).padStart(2, "0")}:00+05:45`;
    payments.push({
      ...p,
      id: payment_id,
      receipt_no: receiptNo(p.kind, payment_id),
      recorded_by: MOCK_USER,
      source: p.kind === "advance" && p.employee_id % 2 === 0 ? "scan" : "account",
      paid_at: at,
      created_at: at,
    });
  };

  for (const employee of employees) {
    for (let k = 0; k < months.length; k += 1) {
      const month = months[k];
      const monthsAgo = months.length - 1 - k;
      if (monthKey(month) < employee.joined.bs.slice(0, 7)) continue;
      const structure = structureFor(structures, employee.id, month);
      if (!structure) continue;
      const summary = mockAttendance(employee.id, month, now);
      const rate = structure.pay_type === "monthly" ? structure.gross : structure.basic;
      const pay = structure.pay_type === "monthly"
        ? monthlyPay(rate, structure.ot_rate, summary)
        : dailyPay(rate, structure.ot_rate, summary);
      const mode: PaidBy = structure.default_payment_mode_id === BANK_MODE_ID ? "bank" : "cash";
      const monthPayments: Payment[] = [];
      const give = (kind: Payment["kind"], amount: number, bs: string, payMode: PaidBy, note: string | null = null) => {
        const due = settle(pay.net, monthPayments).due;
        const clean = Math.min(roundRs(amount), due);
        if (clean <= 0) return;
        // Cash by default; bank salaries through NIC Asia; a few advances through eSewa.
        const modeId = payMode === "bank" ? BANK_MODE_ID : kind === "advance" && employee.id % 7 === 3 ? 3 : CASH_MODE_ID;
        const paymentMode = PAYMENT_MODES.find((pm) => pm.id === modeId)!;
        const payment = {
          employee_id: employee.id,
          for_year: month.bs_year,
          for_month: month.bs_month,
          month,
          kind,
          amount: clean,
          system_remark: `${kind === "advance" ? "Advance" : "Salary"} for ${monthName(month)}`,
          payment_mode_id: modeId,
          payment_mode: modeRef(paymentMode),
          reference: paymentMode.type === "bank" ? bankRef(employee.id, month) : null,
          note,
          date: dateBoth(bs),
        };
        monthPayments.push(payment as Payment);
        addPayment(payment);
      };
      const nextMonth = addMonths(month, 1);
      const salaryDay = 3 + (employee.id % 3);
      const salaryDate = isoBs(nextMonth.bs_year, nextMonth.bs_month, salaryDay);
      const midMonth = isoBs(month.bs_year, month.bs_month, Math.min(12 + (employee.id % 7), summary.days_in_month));

      if (monthsAgo >= 2) {
        if (employee.id % 3 === 0) give("advance", 1000 + (employee.id % 3) * 500, midMonth, "cash", "Festival advance");
        give("salary", settle(pay.net, monthPayments).due, salaryDate, mode);
      } else if (monthsAgo === 1) {
        const bucket = employee.id % 4;
        if (bucket === 1) {
          give("advance", 1500, midMonth, "cash", null);
        } else if (bucket !== 0) {
          if (employee.id % 6 === 2) give("advance", 2000, midMonth, "cash", null);
          if (salaryDay <= todayDay) give("salary", settle(pay.net, monthPayments).due, salaryDate, mode);
        }
      } else if (employee.id % 5 === 0 && todayDay >= 5) {
        give("advance", 1000, isoBs(month.bs_year, month.bs_month, Math.min(5, todayDay)), "cash", null);
      }
    }
  }

  return {
    seeded_for: monthKey(current),
    branches: BRANCHES.map((b) => ({ ...b })),
    departments: DEPARTMENTS.map((d) => ({ ...d })),
    payment_modes: PAYMENT_MODES.map((m) => ({ ...m })),
    employees,
    structures,
    payments,
    photo_tokens: [],
    next_id: { ...next, branch: BRANCHES.length + 1, department: DEPARTMENTS.length + 1 },
  };
}
