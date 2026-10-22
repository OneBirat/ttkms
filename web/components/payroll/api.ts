/**
 * Payroll API client - MOCK EDITION.
 *
 * Every function here has the signature and return shape the real client will
 * have once /api/payroll exists (next session); pages import only this file.
 * State lives in memory, is mirrored to localStorage so a second tab (or the
 * phone-photo page opened on the same device) sees the same data, and every
 * change is broadcast so open pages refresh by themselves.
 */

import type { Role } from "@/lib/api";
import {
  CURRENT_MONTH,
  TODAY,
  compareMonths,
  dateBoth,
  mockDaysInMonth,
  monthKey,
  parseBsDate,
  parseMonthKey,
  sameMonth,
} from "./calendar";
import { computePayslip } from "./calc";
import { normalizeName, normalizePhone, totalsFor } from "./helpers";
import {
  ROLE_LABELS,
  buildSeedState,
  mockAttendance,
  structureFor,
  type MockState,
} from "./mockData";
import type {
  Advance,
  AdvanceIn,
  Branch,
  BsMonth,
  Department,
  DepartmentNetTotal,
  EmployeeIn,
  EmployeeMonthAttendance,
  EmployeeProfile,
  EmployeeUpdateIn,
  MonthNetTotal,
  PayrollRun,
  PayrollSheetRow,
  Payslip,
  PhotoToken,
  PhotoTokenInfo,
  SalaryReport,
  SalaryRevisionIn,
  SalaryStructure,
} from "./types";

export const PHOTO_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Same shape as lib/api ApiError, plus the field an inline error belongs to. */
export class PayrollApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly field: string | null;

  constructor(status: number, detail: string, field: string | null = null) {
    super(detail);
    this.name = "PayrollApiError";
    this.status = status;
    this.detail = detail;
    this.field = field;
  }
}

// ------------------------------------------------------------------ store

const STORAGE_KEY = "ttk.payroll.mock.v1";
const CHANNEL = "ttk.payroll.mock";

type Listener = () => void;
const listeners = new Set<Listener>();
let state: MockState | null = null;
let channel: BroadcastChannel | null = null;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function loadPersisted(): MockState | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MockState) : null;
  } catch {
    return null;
  }
}

function persist(current: MockState): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Quota or private mode: the in-memory copy still works for this tab.
  }
}

function ensureChannel(): void {
  if (channel || !hasWindow() || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => {
    const persisted = loadPersisted();
    if (persisted) {
      state = persisted;
      refreshDraft(state);
      listeners.forEach((listener) => listener());
    }
  };
}

function getState(): MockState {
  if (!state) {
    state = loadPersisted() ?? buildSeedState();
    refreshDraft(state);
    ensureChannel();
  }
  return state;
}

function commit(): void {
  const current = getState();
  refreshDraft(current);
  persist(current);
  listeners.forEach((listener) => listener());
  channel?.postMessage("changed");
}

/** Re-run every page that reads mock data when something changes. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureChannel();
  return () => {
    listeners.delete(listener);
  };
}

/** Throw away every change and go back to the seed (dev helper). */
export async function resetMockData(): Promise<void> {
  state = buildSeedState();
  commit();
}

function nextId(kind: string): number {
  const current = getState();
  const id = current.next_id[kind] ?? 1;
  current.next_id[kind] = id + 1;
  return id;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function respond<T>(value: T): Promise<T> {
  return clone(value);
}

// ---------------------------------------------------- draft recomputation

/**
 * Pending payslips of a draft run always reflect the current salary
 * structure, attendance and open advances; paid payslips are frozen.
 */
function refreshDraft(current: MockState): void {
  for (const run of current.runs) {
    if (run.status !== "draft") continue;
    for (const payslip of run.payslips) {
      if (payslip.status === "paid") continue;
      const structure = structureFor(current.structures, payslip.employee_id, run.month);
      if (!structure) continue;
      const summary = mockAttendance(payslip.employee_id, run.month);
      const open = current.advances.filter(
        (a) => a.employee_id === payslip.employee_id && a.given_on.bs <= `${monthKey(run.month)}-99`,
      );
      const amounts = computePayslip(structure.pay_type, structure.amount, summary, open);
      Object.assign(payslip, {
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
      });
    }
    // New employees join the draft run.
    for (const employee of current.employees) {
      if (employee.status !== "active") continue;
      if (run.payslips.some((p) => p.employee_id === employee.id)) continue;
      const structure = structureFor(current.structures, employee.id, run.month);
      if (!structure) continue;
      const summary = mockAttendance(employee.id, run.month);
      const amounts = computePayslip(structure.pay_type, structure.amount, summary, []);
      run.payslips.push({
        id: nextIdIn(current, "payslip"),
        run_id: run.id,
        employee_id: employee.id,
        month: run.month,
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
        status: "pending",
        paid_on: null,
      });
    }
  }
}

function nextIdIn(current: MockState, kind: string): number {
  const id = current.next_id[kind] ?? 1;
  current.next_id[kind] = id + 1;
  return id;
}

// ------------------------------------------------------------------- core

export async function listBranches(): Promise<Branch[]> {
  return respond(getState().branches.filter((b) => b.is_active));
}

export async function listDepartments(): Promise<Department[]> {
  return respond(getState().departments.filter((d) => d.is_active));
}

/** Needs a core endpoint (POST /api/core/branches) - see the session report. */
export async function createBranch(name: string): Promise<Branch> {
  const current = getState();
  const clean = name.trim();
  if (!clean) throw new PayrollApiError(422, "Branch name is required.", "name");
  if (current.branches.some((b) => normalizeName(b.name) === normalizeName(clean))) {
    throw new PayrollApiError(409, "A branch with this name already exists.", "name");
  }
  const branch: Branch = { id: nextId("branch"), name: clean, is_active: true };
  current.branches.push(branch);
  commit();
  return respond(branch);
}

/** Needs a core endpoint (POST /api/core/departments) - see the session report. */
export async function createDepartment(name: string): Promise<Department> {
  const current = getState();
  const clean = name.trim();
  if (!clean) throw new PayrollApiError(422, "Department name is required.", "name");
  if (current.departments.some((d) => normalizeName(d.name) === normalizeName(clean))) {
    throw new PayrollApiError(409, "A department with this name already exists.", "name");
  }
  const department: Department = { id: nextId("department"), name: clean, is_active: true };
  current.departments.push(department);
  commit();
  return respond(department);
}

// -------------------------------------------------------------- employees

export async function listEmployees(): Promise<EmployeeProfile[]> {
  return respond(getState().employees);
}

function findEmployee(id: number): EmployeeProfile {
  const employee = getState().employees.find((e) => e.id === id);
  if (!employee) throw new PayrollApiError(404, "Employee not found.");
  return employee;
}

export async function getEmployee(id: number): Promise<EmployeeProfile> {
  return respond(findEmployee(id));
}

/** The code the next employee will get (core.next_employee_code()). */
export async function nextEmployeeCode(): Promise<string> {
  const next = getState().next_id.employee ?? 1;
  return `E-${String(next).padStart(3, "0")}`;
}

function validateEmployeeFields(input: {
  full_name: string;
  phone: string;
  branch_id: number;
  department_id: number;
  designation: string;
}): void {
  if (!input.full_name.trim()) throw new PayrollApiError(422, "Full name is required.", "full_name");
  if (!normalizePhone(input.phone)) throw new PayrollApiError(422, "Phone is required.", "phone");
  if (normalizePhone(input.phone).length < 7) {
    throw new PayrollApiError(422, "Enter a valid phone number.", "phone");
  }
  if (!input.branch_id) throw new PayrollApiError(422, "Choose a branch.", "branch_id");
  if (!input.department_id) throw new PayrollApiError(422, "Choose a department.", "department_id");
  if (!input.designation.trim()) throw new PayrollApiError(422, "Designation is required.", "designation");
}

function assertUniquePhone(phone: string, exceptId: number | null): void {
  const clean = normalizePhone(phone);
  const clash = getState().employees.find(
    (e) => e.id !== exceptId && e.phone && normalizePhone(e.phone) === clean,
  );
  if (clash) {
    throw new PayrollApiError(
      409,
      `This phone number already belongs to ${clash.full_name} (${clash.code}).`,
      "phone",
    );
  }
}

function assertUniqueUsername(username: string): void {
  const clean = username.trim().toLowerCase();
  if (!clean) throw new PayrollApiError(422, "Username is required.", "username");
  if (!/^[a-z0-9._-]{3,32}$/.test(clean)) {
    throw new PayrollApiError(
      422,
      "Use 3–32 letters, digits, dots, dashes or underscores.",
      "username",
    );
  }
  const taken = ["admin", ...getState().employees.map((e) => e.login?.username ?? "")];
  if (taken.includes(clean)) {
    throw new PayrollApiError(409, "This username is already taken.", "username");
  }
}

export interface EmployeeCreated {
  employee: EmployeeProfile;
  /** Shown once when a login was created. */
  one_time_password: string | null;
}

export async function createEmployee(input: EmployeeIn): Promise<EmployeeCreated> {
  const current = getState();
  validateEmployeeFields(input);
  if (!(input.amount > 0)) {
    throw new PayrollApiError(422, "Enter the salary or wage amount.", "amount");
  }
  assertUniquePhone(input.phone, null);
  if (input.login) assertUniqueUsername(input.login.username);
  const branch = current.branches.find((b) => b.id === input.branch_id);
  const department = current.departments.find((d) => d.id === input.department_id);
  if (!branch) throw new PayrollApiError(422, "Choose a branch.", "branch_id");
  if (!department) throw new PayrollApiError(422, "Choose a department.", "department_id");

  const id = nextId("employee");
  const employee: EmployeeProfile = {
    id,
    code: `E-${String(id).padStart(3, "0")}`,
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    branch,
    department,
    designation: input.designation.trim(),
    status: "active",
    photo_url: input.photo_data_url ?? null,
    login: input.login
      ? {
          user_id: nextId("user"),
          username: input.login.username.trim().toLowerCase(),
          role: input.login.role,
          role_label: ROLE_LABELS[input.login.role],
        }
      : null,
    created_at: TODAY.bs,
  };
  current.employees.push(employee);
  current.structures.push({
    id: nextId("structure"),
    employee_id: id,
    pay_type: input.pay_type,
    amount: Math.round(input.amount),
    paid_by: input.paid_by,
    effective_from: dateBoth(`${monthKey(CURRENT_MONTH)}-01`),
    allowances: [],
    previous_amount: null,
  });
  commit();
  return respond({
    employee,
    one_time_password: input.login ? oneTimePassword() : null,
  });
}

function oneTimePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function updateEmployee(id: number, input: EmployeeUpdateIn): Promise<EmployeeProfile> {
  const current = getState();
  const employee = findEmployee(id);
  validateEmployeeFields(input);
  assertUniquePhone(input.phone, id);
  const branch = current.branches.find((b) => b.id === input.branch_id);
  const department = current.departments.find((d) => d.id === input.department_id);
  if (!branch) throw new PayrollApiError(422, "Choose a branch.", "branch_id");
  if (!department) throw new PayrollApiError(422, "Choose a department.", "department_id");
  Object.assign(employee, {
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    branch,
    department,
    designation: input.designation.trim(),
    status: input.status,
  });
  commit();
  return respond(employee);
}

/** `photo` is a data: URL from the capture flow, or null to remove the photo. */
export async function setEmployeePhoto(id: number, photo: string | null): Promise<EmployeeProfile> {
  const employee = findEmployee(id);
  employee.photo_url = photo;
  commit();
  return respond(employee);
}

// ----------------------------------------------------------------- salary

export interface SalaryStructureOut {
  current: SalaryStructure | null;
  history: SalaryStructure[];
}

export async function getSalaryStructure(employee_id: number): Promise<SalaryStructureOut> {
  findEmployee(employee_id);
  const history = getState()
    .structures.filter((s) => s.employee_id === employee_id)
    .sort((a, b) => b.effective_from.bs.localeCompare(a.effective_from.bs) || b.id - a.id);
  return respond({ current: history[0] ?? null, history });
}

export async function reviseSalary(employee_id: number, input: SalaryRevisionIn): Promise<SalaryStructure> {
  const current = getState();
  findEmployee(employee_id);
  if (!(input.amount > 0)) throw new PayrollApiError(422, "Enter the new amount.", "amount");
  if (!parseBsDate(input.effective_from_bs)) {
    throw new PayrollApiError(422, "Enter the effective date as YYYY-MM-DD (BS).", "effective_from_bs");
  }
  const previous = structureFor(current.structures, employee_id, CURRENT_MONTH);
  const structure: SalaryStructure = {
    id: nextId("structure"),
    employee_id,
    pay_type: input.pay_type,
    amount: Math.round(input.amount),
    paid_by: input.paid_by,
    effective_from: dateBoth(input.effective_from_bs),
    allowances: [],
    previous_amount: previous ? previous.amount : null,
  };
  current.structures.push(structure);
  commit();
  return respond(structure);
}

// --------------------------------------------------------------- advances

export async function listAdvances(employee_id: number): Promise<Advance[]> {
  findEmployee(employee_id);
  return respond(
    getState()
      .advances.filter((a) => a.employee_id === employee_id)
      .sort((a, b) => b.given_on.bs.localeCompare(a.given_on.bs) || b.id - a.id),
  );
}

export async function giveAdvance(employee_id: number, input: AdvanceIn): Promise<Advance> {
  const current = getState();
  findEmployee(employee_id);
  if (!(input.amount > 0)) throw new PayrollApiError(422, "Enter the advance amount.", "amount");
  if (!(input.monthly_recovery > 0)) {
    throw new PayrollApiError(422, "Enter the monthly recovery amount.", "monthly_recovery");
  }
  if (input.monthly_recovery > input.amount) {
    throw new PayrollApiError(422, "Monthly recovery cannot exceed the advance.", "monthly_recovery");
  }
  if (!parseBsDate(input.given_on_bs)) {
    throw new PayrollApiError(422, "Enter the date as YYYY-MM-DD (BS).", "given_on_bs");
  }
  const advance: Advance = {
    id: nextId("advance"),
    employee_id,
    amount: Math.round(input.amount),
    given_on: dateBoth(input.given_on_bs),
    monthly_recovery: Math.round(input.monthly_recovery),
    note: input.note?.trim() || null,
    recoveries: [],
    outstanding: Math.round(input.amount),
  };
  current.advances.push(advance);
  commit();
  return respond(advance);
}

// ------------------------------------------------------------- attendance

/** Mirrors AttendanceSummary.for_month(employee_id, bs_year, bs_month). */
export async function getAttendance(employee_id: number, month: BsMonth): Promise<EmployeeMonthAttendance> {
  findEmployee(employee_id);
  return respond({ employee_id, month, summary: mockAttendance(employee_id, month) });
}

// ---------------------------------------------------------------- payroll

/** Months with a payroll run, newest first. */
export async function listPayrollMonths(): Promise<BsMonth[]> {
  return respond(
    getState()
      .runs.map((r) => r.month)
      .sort((a, b) => compareMonths(b, a)),
  );
}

export function currentMonth(): BsMonth {
  return { ...CURRENT_MONTH };
}

function findRun(month: BsMonth): PayrollRun {
  const run = getState().runs.find((r) => sameMonth(r.month, month));
  if (!run) throw new PayrollApiError(404, "No payroll run for this month.");
  return run;
}

export async function getRun(month: BsMonth): Promise<PayrollRun> {
  return respond(findRun(month));
}

/** This employee's payslips, newest month first. */
export async function getLedger(employee_id: number): Promise<Payslip[]> {
  findEmployee(employee_id);
  const slips = getState()
    .runs.flatMap((r) => r.payslips)
    .filter((p) => p.employee_id === employee_id)
    .sort((a, b) => compareMonths(b.month, a.month));
  return respond(slips);
}

function settle(current: MockState, run: PayrollRun, payslip: Payslip): void {
  if (payslip.status === "paid") return;
  payslip.status = "paid";
  payslip.paid_on = { ...TODAY };
  const open = current.advances
    .filter((a) => a.employee_id === payslip.employee_id && a.outstanding > 0)
    .sort((a, b) => a.given_on.bs.localeCompare(b.given_on.bs) || a.id - b.id);
  let left = payslip.advance_recovered;
  for (const advance of open) {
    if (left <= 0) break;
    const amount = Math.min(advance.monthly_recovery, advance.outstanding, left);
    if (amount <= 0) continue;
    advance.recoveries.push({
      id: nextIdIn(current, "recovery"),
      advance_id: advance.id,
      payslip_id: payslip.id,
      month: run.month,
      amount,
    });
    advance.outstanding -= amount;
    left -= amount;
  }
  if (run.payslips.every((p) => p.status === "paid")) run.status = "paid";
}

/** "Pay <month> salary" on the employee account. */
export async function payEmployee(employee_id: number, month: BsMonth): Promise<Payslip> {
  const current = getState();
  const run = findRun(month);
  const payslip = run.payslips.find((p) => p.employee_id === employee_id);
  if (!payslip) throw new PayrollApiError(404, "No payslip for this employee in that month.");
  if (payslip.status === "paid") throw new PayrollApiError(409, "This salary is already paid.");
  settle(current, run, payslip);
  commit();
  return respond(payslip);
}

/** "Mark pending as paid" on the report; limited to one department when given. */
export async function markPendingPaid(month: BsMonth, department_id: number | null = null): Promise<number> {
  const current = getState();
  const run = findRun(month);
  let count = 0;
  for (const payslip of run.payslips) {
    if (payslip.status === "paid") continue;
    if (department_id !== null) {
      const employee = current.employees.find((e) => e.id === payslip.employee_id);
      if (employee?.department?.id !== department_id) continue;
    }
    settle(current, run, payslip);
    count += 1;
  }
  if (count) commit();
  return count;
}

export async function getSalaryReport(month: BsMonth, department_id: number | null = null): Promise<SalaryReport> {
  const current = getState();
  const run = findRun(month);
  const employeeById = new Map(current.employees.map((e) => [e.id, e]));
  const allRows: PayrollSheetRow[] = run.payslips
    .map((payslip) => ({ payslip, employee: employeeById.get(payslip.employee_id)! }))
    .filter((row) => row.employee);
  const rows =
    department_id === null
      ? allRows
      : allRows.filter((row) => row.employee.department?.id === department_id);
  const employeeIds = new Set(rows.map((r) => r.employee.id));
  const outstanding = current.advances
    .filter((a) => employeeIds.has(a.employee_id))
    .reduce((sum, a) => sum + a.outstanding, 0);
  const by_department: DepartmentNetTotal[] = current.departments
    .filter((d) => d.is_active)
    .map((department) => {
      const slips = allRows.filter((r) => r.employee.department?.id === department.id);
      return {
        department,
        staff: slips.length,
        net_pay: slips.reduce((sum, r) => sum + r.payslip.net_pay, 0),
      };
    });
  const trend: MonthNetTotal[] = current.runs
    .filter((r) => compareMonths(r.month, month) <= 0)
    .sort((a, b) => compareMonths(a.month, b.month))
    .slice(-6)
    .map((r) => ({
      month: r.month,
      net_pay: r.payslips
        .filter((p) => {
          if (department_id === null) return true;
          return employeeById.get(p.employee_id)?.department?.id === department_id;
        })
        .reduce((sum, p) => sum + p.net_pay, 0),
    }));
  return respond({
    month,
    run,
    rows,
    totals: totalsFor(
      rows.map((r) => r.payslip),
      outstanding,
    ),
    by_department,
    trend,
  });
}

// ------------------------------------------------------------------ photo

function randomToken(): string {
  const bytes = new Uint8Array(16);
  if (hasWindow() && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pruneTokens(current: MockState): void {
  const now = Date.now();
  current.photo_tokens = current.photo_tokens.filter((t) => Date.parse(t.expires_at) > now);
}

/** A 10-minute link for the phone capture page; the QR code encodes `url`. */
export async function createPhotoToken(employee_id: number, origin: string): Promise<PhotoToken> {
  const current = getState();
  findEmployee(employee_id);
  pruneTokens(current);
  const token = randomToken();
  const expires_at = new Date(Date.now() + PHOTO_TOKEN_TTL_MS).toISOString();
  current.photo_tokens.push({ token, employee_id, expires_at });
  commit();
  return respond({ token, employee_id, url: `${origin}/payroll/photo/${token}`, expires_at });
}

export async function resolvePhotoToken(token: string): Promise<PhotoTokenInfo> {
  const current = getState();
  pruneTokens(current);
  const found = current.photo_tokens.find((t) => t.token === token);
  if (!found) throw new PayrollApiError(410, "This link has expired. Ask for a new QR code.");
  return respond({ employee: findEmployee(found.employee_id), expires_at: found.expires_at });
}

export async function uploadPhotoByToken(token: string, photo: string): Promise<EmployeeProfile> {
  const info = await resolvePhotoToken(token);
  return setEmployeePhoto(info.employee.id, photo);
}

// ----------------------------------------------------------------- misc

export { monthKey, parseMonthKey, mockDaysInMonth };
export type { Role };
