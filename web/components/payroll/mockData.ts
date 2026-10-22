/**
 * Seed for the in-memory payroll mock (api.ts). The payslips of past months
 * are generated here with the same calc.ts the UI uses, so every number on
 * the screens follows the decided rules. Replace with the backend next session.
 */

import type { Role } from "@/lib/api";
import {
  CURRENT_MONTH,
  addMonths,
  compareMonths,
  dateBoth,
  mockDaysInMonth,
  monthOf,
} from "./calendar";
import { computePayslip } from "./calc";
import type {
  Advance,
  Branch,
  BsMonth,
  Department,
  EmployeeProfile,
  MonthSummary,
  PaidBy,
  PayType,
  PayrollRun,
  Payslip,
  SalaryStructure,
} from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  store_keeper: "Store keeper",
  staff: "Staff",
};

export interface MockPhotoToken {
  token: string;
  employee_id: number;
  expires_at: string;
}

export interface MockState {
  branches: Branch[];
  departments: Department[];
  employees: EmployeeProfile[];
  structures: SalaryStructure[];
  advances: Advance[];
  runs: PayrollRun[];
  photo_tokens: MockPhotoToken[];
  next_id: Record<string, number>;
}

export const BRANCHES: Branch[] = [
  { id: 1, name: "Main branch", is_active: true },
  { id: 2, name: "Branch 2", is_active: true },
];

export const DEPARTMENTS: Department[] = [
  { id: 1, name: "Store", is_active: true },
  { id: 2, name: "Kitchen", is_active: true },
  { id: 3, name: "Housekeeping", is_active: true },
  { id: 4, name: "Front desk", is_active: true },
  { id: 5, name: "Accounts", is_active: true },
];

type Seed = [
  name: string,
  designation: string,
  department: number,
  branch: number,
  pay: PayType,
  amount: number,
  paid_by: PaidBy,
  previous?: number,
];

/** 25 staff, codes E-001… in this order (a mix of monthly and daily wage). */
const SEED: Seed[] = [
  ["Anita Gurung", "Store keeper", 1, 1, "monthly", 22000, "bank", 20000],
  ["Ramesh K.C.", "Store helper", 1, 1, "daily", 650, "cash"],
  ["Dipak Adhikari", "Store helper", 1, 1, "daily", 650, "cash"],
  ["Kamala Bhandari", "Cashier", 1, 1, "monthly", 20000, "bank"],
  ["Nabin Poudel", "Driver", 1, 1, "monthly", 18000, "cash"],
  ["Bikash Shrestha", "Head cook", 2, 1, "monthly", 26000, "bank", 24000],
  ["Gita Magar", "Cook", 2, 1, "monthly", 19000, "cash"],
  ["Hari Bista", "Kitchen helper", 2, 1, "daily", 600, "cash"],
  ["Laxmi Karki", "Kitchen helper", 2, 1, "daily", 600, "cash"],
  ["Prakash Rana", "Cook", 2, 2, "monthly", 19000, "cash"],
  ["Sita Thapa", "Supervisor", 3, 1, "monthly", 20000, "bank"],
  ["Maya Tamang", "Housekeeper", 3, 1, "daily", 550, "cash"],
  ["Rita Shahi", "Housekeeper", 3, 1, "daily", 550, "cash"],
  ["Sunita B.K.", "Housekeeper", 3, 1, "daily", 550, "cash"],
  ["Bimala Oli", "Laundry", 3, 2, "daily", 550, "cash"],
  ["Priya Rai", "Front desk lead", 4, 1, "monthly", 24000, "bank", 22000],
  ["Suman Tamang", "Receptionist", 4, 2, "monthly", 18000, "bank"],
  ["Aarati Joshi", "Receptionist", 4, 1, "monthly", 18000, "bank"],
  ["Kiran Lama", "Night auditor", 4, 2, "monthly", 19500, "bank"],
  ["Rajesh Pandey", "Accountant", 5, 1, "monthly", 32000, "bank", 30000],
  ["Sabina Khadka", "Asst. accountant", 5, 1, "monthly", 22000, "bank"],
  ["Manoj Dahal", "Purchase officer", 5, 1, "monthly", 24000, "bank"],
  ["Asmita Ghimire", "HR officer", 5, 1, "monthly", 25000, "bank"],
  ["Bishal Neupane", "IT support", 5, 1, "monthly", 23000, "bank"],
  ["Dil Bahadur Rai", "Driver", 1, 2, "monthly", 17500, "cash"],
];

const LOGINS: Record<number, { username: string; role: Role }> = {
  1: { username: "anita.g", role: "staff" },
  4: { username: "kamala.b", role: "store_keeper" },
  20: { username: "rajesh.p", role: "manager" },
  23: { username: "asmita.g", role: "admin" },
};

/** Revised salaries took effect from Ashadh 1, 2083. */
const REVISION_FROM = "2083-03-01";
const ORIGINAL_FROM = "2082-04-01";

interface AdvanceSeed {
  employee_id: number;
  amount: number;
  given_on: string;
  monthly_recovery: number;
  note: string | null;
}

const ADVANCE_SEED: AdvanceSeed[] = [
  { employee_id: 1, amount: 10000, given_on: "2083-04-10", monthly_recovery: 2500, note: "Festival advance" },
  { employee_id: 7, amount: 4000, given_on: "2083-05-20", monthly_recovery: 2000, note: null },
  { employee_id: 11, amount: 3000, given_on: "2083-05-15", monthly_recovery: 3000, note: "Medical" },
  { employee_id: 16, amount: 6000, given_on: "2083-06-28", monthly_recovery: 1500, note: null },
  { employee_id: 12, amount: 2000, given_on: "2083-06-10", monthly_recovery: 1000, note: null },
];

/** Months that have a payroll run: Baishakh…Ashwin 2083 (Ashwin = current, draft). */
export const RUN_MONTHS: BsMonth[] = [5, 4, 3, 2, 1, 0].map((back) =>
  addMonths(CURRENT_MONTH, -back),
);

/**
 * Deterministic attendance in the shape of app/contracts.py MonthSummary.
 * Same recipe as FakeAttendanceSummary, with paid_days following the decided
 * rule (days − absent − ½ × half days).
 */
export function mockAttendance(employee_id: number, month: BsMonth): MonthSummary {
  const days = mockDaysInMonth(month);
  const seed = (employee_id * 31 + month.bs_year * 12 + month.bs_month) % 7;
  let weekly_off = 0;
  for (let d = 0; d < days; d += 1) if ((d + seed) % 7 === 0) weekly_off += 1;
  const working = days - weekly_off;
  const leave = seed % 3;
  const absent = (seed + 1) % 2;
  const half_days = (seed + employee_id) % 3;
  const late = seed;
  const present = working - leave - absent - half_days * 0.5;
  return {
    days_in_month: days,
    present,
    late,
    half_days,
    leave,
    absent,
    weekly_off,
    paid_days: days - absent - half_days * 0.5,
  };
}

/** Structure in force for a month: the latest one effective on or before it. */
export function structureFor(
  structures: SalaryStructure[],
  employee_id: number,
  month: BsMonth,
): SalaryStructure | null {
  const candidates = structures
    .filter((s) => s.employee_id === employee_id)
    .filter((s) => {
      const from = monthOf(s.effective_from.bs);
      return from ? compareMonths(from, month) <= 0 : false;
    })
    .sort((a, b) => a.effective_from.bs.localeCompare(b.effective_from.bs) || a.id - b.id);
  return candidates[candidates.length - 1] ?? null;
}

export function buildSeedState(): MockState {
  const employees: EmployeeProfile[] = SEED.map((seed, index) => {
    const id = index + 1;
    const login = LOGINS[id];
    return {
      id,
      code: `E-${String(id).padStart(3, "0")}`,
      full_name: seed[0],
      phone: `98${String(41000000 + id * 7919).padStart(8, "0")}`,
      branch: BRANCHES[seed[3] - 1],
      department: DEPARTMENTS[seed[2] - 1],
      designation: seed[1],
      status: "active",
      photo_url: null,
      login: login
        ? { user_id: 100 + id, username: login.username, role: login.role, role_label: ROLE_LABELS[login.role] }
        : null,
      created_at: "2082-04-01",
    };
  });

  const structures: SalaryStructure[] = [];
  let structureId = 1;
  SEED.forEach((seed, index) => {
    const employee_id = index + 1;
    const previous = seed[7];
    if (previous !== undefined) {
      structures.push({
        id: structureId++,
        employee_id,
        pay_type: seed[4],
        amount: previous,
        paid_by: seed[6],
        effective_from: dateBoth(ORIGINAL_FROM),
        allowances: [],
        previous_amount: null,
      });
    }
    structures.push({
      id: structureId++,
      employee_id,
      pay_type: seed[4],
      amount: seed[5],
      paid_by: seed[6],
      effective_from: dateBoth(previous !== undefined ? REVISION_FROM : ORIGINAL_FROM),
      allowances: [],
      previous_amount: previous ?? null,
    });
  });

  const advances: Advance[] = ADVANCE_SEED.map((seed, index) => ({
    id: index + 1,
    employee_id: seed.employee_id,
    amount: seed.amount,
    given_on: dateBoth(seed.given_on),
    monthly_recovery: seed.monthly_recovery,
    note: seed.note,
    recoveries: [],
    outstanding: seed.amount,
  }));

  const runs: PayrollRun[] = [];
  let payslipId = 1;
  let recoveryId = 1;
  const months = [...RUN_MONTHS].sort(compareMonths);
  months.forEach((month, runIndex) => {
    const isCurrent = compareMonths(month, CURRENT_MONTH) === 0;
    const run: PayrollRun = {
      id: runIndex + 1,
      month,
      status: isCurrent ? "draft" : "paid",
      days_in_month: mockDaysInMonth(month),
      payslips: [],
    };
    const payDay = addMonths(month, 1);
    const paid_on = dateBoth(
      `${payDay.bs_year}-${String(payDay.bs_month).padStart(2, "0")}-02`,
    );
    employees.forEach((employee) => {
      const structure = structureFor(structures, employee.id, month);
      if (!structure) return;
      // Advances given after this month did not exist yet.
      const open = advances.filter(
        (a) => a.employee_id === employee.id && a.given_on.bs <= `${monthKeyOf(month)}-99`,
      );
      const summary = mockAttendance(employee.id, month);
      const amounts = computePayslip(structure.pay_type, structure.amount, summary, open);
      // In the current (draft) run, about a quarter of the staff is still pending.
      const paid = !isCurrent || employee.id % 4 !== 2;
      const payslip: Payslip = {
        id: payslipId++,
        run_id: run.id,
        employee_id: employee.id,
        month,
        pay_type: structure.pay_type,
        rate: structure.amount,
        paid_by: structure.paid_by,
        days_in_month: summary.days_in_month,
        paid_days: amounts.paid_days,
        unpaid_days: amounts.unpaid_days,
        gross: amounts.gross,
        absence_deduction: amounts.absence_deduction,
        advance_recovered: amounts.advance_recovered,
        tds: amounts.tds,
        net_pay: amounts.net_pay,
        status: paid ? "paid" : "pending",
        paid_on: paid ? paid_on : null,
      };
      if (paid) {
        for (const line of amounts.recoveries) {
          const advance = advances.find((a) => a.id === line.advance_id)!;
          advance.recoveries.push({
            id: recoveryId++,
            advance_id: advance.id,
            payslip_id: payslip.id,
            month,
            amount: line.amount,
          });
          advance.outstanding -= line.amount;
        }
      }
      run.payslips.push(payslip);
    });
    runs.push(run);
  });

  return {
    branches: BRANCHES.map((b) => ({ ...b })),
    departments: DEPARTMENTS.map((d) => ({ ...d })),
    employees,
    structures,
    advances,
    runs,
    photo_tokens: [],
    next_id: {
      employee: employees.length + 1,
      structure: structureId,
      advance: advances.length + 1,
      recovery: recoveryId,
      payslip: payslipId,
      run: runs.length + 1,
      branch: BRANCHES.length + 1,
      department: DEPARTMENTS.length + 1,
      user: 200,
    },
  };
}

function monthKeyOf(month: BsMonth): string {
  return `${month.bs_year}-${String(month.bs_month).padStart(2, "0")}`;
}
