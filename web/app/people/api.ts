/**
 * People & payroll API client - MOCK EDITION.
 *
 * Every function here has the signature and return shape the real client will
 * have once /api/payroll exists (after UI sign-off); pages import only this
 * file. State lives in memory, is mirrored to localStorage so a second tab
 * (or the phone-photo page opened on the same device) sees the same data, and
 * every change is broadcast so open pages refresh by themselves.
 *
 * Planned endpoints are noted above each function.
 */

import type { Role } from "@/lib/api";
import { dailyPay, defaultOtRate, monthlyPay, paymentError, settle } from "./_lib/calc";
import {
  addMonths,
  compareMonths,
  dateBoth,
  daysInMonth,
  isValidBs,
  monthEnd,
  monthKey,
  monthLabel,
  monthStart,
  parseMonthKey,
  sameMonth,
  thisMonth,
  today,
} from "./_lib/calendar";
import { barcodeFor, employeeCode, normalizeName, normalizePhone, totalsFor } from "./_lib/helpers";
import {
  MOCK_USER,
  ROLE_LABELS,
  buildSeedState,
  mockAttendance,
  monthsKept,
  structureFor,
  type MockState,
} from "./_lib/mockData";
import type {
  Branch,
  BsMonth,
  Department,
  DepartmentNetTotal,
  Employee,
  EmployeeIn,
  EmployeeUpdateIn,
  MonthBalance,
  MonthLedger,
  MonthNetTotal,
  MonthSummary,
  Payment,
  PaymentInput,
  PaymentResult,
  PaymentsRegister,
  PhotoToken,
  PhotoTokenInfo,
  RegisterRow,
  RegisterTypeFilter,
  ReportRow,
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

const STORAGE_KEY = "ttk.people.mock.v2";
const CHANNEL = "ttk.people.mock";

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
    const parsed = raw ? (JSON.parse(raw) as MockState) : null;
    // A new BS month: start again so the running month is always "now".
    if (parsed && parsed.seeded_for !== monthKey(thisMonth())) return null;
    return parsed;
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
      listeners.forEach((listener) => listener());
    }
  };
}

function getState(): MockState {
  if (!state) {
    state = loadPersisted() ?? buildSeedState();
    ensureChannel();
  }
  return state;
}

function commit(): void {
  const current = getState();
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

/** Throw away every change and go back to the seed (dev helper, also used by tests). */
export async function resetMockData(now: Date = new Date()): Promise<void> {
  state = buildSeedState(now);
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

// ------------------------------------------------------------------- core

/** GET /api/core/branches */
export async function listBranches(): Promise<Branch[]> {
  return respond(getState().branches.filter((b) => b.is_active));
}

/** GET /api/core/departments */
export async function listDepartments(): Promise<Department[]> {
  return respond(getState().departments.filter((d) => d.is_active));
}

/** POST /api/core/branches {name} (NEEDS FROM MAIN) */
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

/** POST /api/core/departments {name} (NEEDS FROM MAIN) */
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

/** GET /api/payroll/employees (filter/sort happen client-side on ~100 rows) */
export async function listEmployees(): Promise<Employee[]> {
  return respond(getState().employees);
}

function findEmployee(id: number): Employee {
  const employee = getState().employees.find((e) => e.id === id);
  if (!employee) throw new PayrollApiError(404, "Employee not found.");
  return employee;
}

/** GET /api/payroll/employees/{id} */
export async function getEmployee(id: number): Promise<Employee> {
  return respond(findEmployee(id));
}

/** GET /api/payroll/employees/by-barcode/{barcode} (the attendance scanner uses this) */
export async function getEmployeeByBarcode(barcode: string): Promise<Employee> {
  const clean = barcode.trim().toUpperCase();
  const employee = getState().employees.find((e) => e.barcode === clean);
  if (!employee) throw new PayrollApiError(404, "No employee with this barcode.");
  return respond(employee);
}

/** GET /api/payroll/employees/next-code -> { code, barcode } */
export async function nextEmployeeCode(): Promise<{ code: string; barcode: string }> {
  const code = employeeCode(getState().next_id.employee ?? 1);
  return { code, barcode: barcodeFor(code) };
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
  if (normalizePhone(input.phone).replace(/^977/, "").length < 7) {
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
    throw new PayrollApiError(422, "Use 3–32 letters, digits, dots, dashes or underscores.", "username");
  }
  const taken = ["admin", ...getState().employees.map((e) => e.login?.username ?? "")];
  if (taken.includes(clean)) {
    throw new PayrollApiError(409, "This username is already taken.", "username");
  }
}

function cleanOptional(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

export interface EmployeeCreated {
  employee: Employee;
  /** Shown once when a login was created. */
  one_time_password: string | null;
}

/** POST /api/payroll/employees  (409 with `field` on duplicate phone/username, 422 with `field`) */
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
  const joined_bs = input.joined_bs?.trim() || today().bs;
  if (!isValidBs(joined_bs)) throw new PayrollApiError(422, "Enter the joining date as YYYY-MM-DD (BS).", "joined_bs");

  const id = nextId("employee");
  const code = employeeCode(id);
  const employee: Employee = {
    id,
    code,
    barcode: barcodeFor(code),
    full_name: input.full_name.trim(),
    full_name_np: cleanOptional(input.full_name_np),
    phone: input.phone.trim(),
    phone_alt: cleanOptional(input.phone_alt),
    address: cleanOptional(input.address),
    branch,
    department,
    designation: input.designation.trim(),
    active: true,
    joined: dateBoth(joined_bs),
    photo_url: input.photo_data_url ?? null,
    login: input.login
      ? {
          user_id: nextId("user"),
          username: input.login.username.trim().toLowerCase(),
          role: input.login.role,
          role_label: ROLE_LABELS[input.login.role],
        }
      : null,
    created_at: today().bs,
  };
  current.employees.push(employee);
  const amount = Math.round(input.amount);
  current.structures.push({
    id: nextId("structure"),
    employee_id: id,
    pay_type: input.pay_type,
    basic: amount,
    allowances: 0,
    gross: amount,
    ot_rate: defaultOtRate(input.pay_type, amount, daysInMonth(thisMonth())),
    paid_by: input.paid_by,
    effective_from: dateBoth(joined_bs),
    reason: null,
    previous_gross: null,
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

/** PATCH /api/payroll/employees/{id} */
export async function updateEmployee(id: number, input: EmployeeUpdateIn): Promise<Employee> {
  const current = getState();
  const employee = findEmployee(id);
  validateEmployeeFields(input);
  assertUniquePhone(input.phone, id);
  const branch = current.branches.find((b) => b.id === input.branch_id);
  const department = current.departments.find((d) => d.id === input.department_id);
  if (!branch) throw new PayrollApiError(422, "Choose a branch.", "branch_id");
  if (!department) throw new PayrollApiError(422, "Choose a department.", "department_id");
  if (!isValidBs(input.joined_bs)) throw new PayrollApiError(422, "Enter the joining date as YYYY-MM-DD (BS).", "joined_bs");
  Object.assign(employee, {
    full_name: input.full_name.trim(),
    full_name_np: cleanOptional(input.full_name_np),
    phone: input.phone.trim(),
    phone_alt: cleanOptional(input.phone_alt),
    address: cleanOptional(input.address),
    branch,
    department,
    designation: input.designation.trim(),
    active: input.active,
    joined: dateBoth(input.joined_bs),
  });
  commit();
  return respond(employee);
}

/** PUT / DELETE /api/payroll/employees/{id}/photo. `photo` is a data: URL, or null to remove. */
export async function setEmployeePhoto(id: number, photo: string | null): Promise<Employee> {
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

/** GET /api/payroll/employees/{id}/salary */
export async function getSalaryStructure(employee_id: number): Promise<SalaryStructureOut> {
  findEmployee(employee_id);
  const history = getState()
    .structures.filter((s) => s.employee_id === employee_id)
    .sort((a, b) => b.effective_from.bs.localeCompare(a.effective_from.bs) || b.id - a.id);
  return respond({ current: history[0] ?? null, history });
}

/** POST /api/payroll/employees/{id}/salary */
export async function reviseSalary(employee_id: number, input: SalaryRevisionIn): Promise<SalaryStructure> {
  const current = getState();
  findEmployee(employee_id);
  if (!(input.basic > 0)) throw new PayrollApiError(422, "Enter the new amount.", "basic");
  if (input.allowances < 0 || !Number.isFinite(input.allowances)) {
    throw new PayrollApiError(422, "Allowances cannot be negative.", "allowances");
  }
  if (!(input.ot_rate >= 0) || !Number.isFinite(input.ot_rate)) {
    throw new PayrollApiError(422, "Enter the overtime rate per hour.", "ot_rate");
  }
  if (!isValidBs(input.effective_from_bs)) {
    throw new PayrollApiError(422, "Enter the effective date as YYYY-MM-DD (BS).", "effective_from_bs");
  }
  const previous = structureFor(current.structures, employee_id, thisMonth());
  const basic = Math.round(input.basic);
  const allowances = input.pay_type === "monthly" ? Math.round(input.allowances) : 0;
  const structure: SalaryStructure = {
    id: nextId("structure"),
    employee_id,
    pay_type: input.pay_type,
    basic,
    allowances,
    gross: basic + allowances,
    ot_rate: Math.round(input.ot_rate),
    paid_by: input.paid_by,
    effective_from: dateBoth(input.effective_from_bs),
    reason: cleanOptional(input.reason),
    previous_gross: previous ? previous.gross : null,
  };
  current.structures.push(structure);
  commit();
  return respond(structure);
}

// ------------------------------------------------------------- attendance

export interface EmployeeMonthAttendance {
  employee_id: number;
  month: BsMonth;
  summary: MonthSummary;
}

/** Mirrors AttendanceSummary.for_month(employee_id, bs_year, bs_month) (the Fake until attendance ships). */
export async function getAttendance(employee_id: number, month: BsMonth): Promise<EmployeeMonthAttendance> {
  findEmployee(employee_id);
  return respond({ employee_id, month, summary: mockAttendance(employee_id, month) });
}

// ----------------------------------------------------------------- ledger

/** The BS month running today. */
export function currentMonth(): BsMonth {
  return thisMonth();
}

/** GET /api/payroll/months — months with payroll data, newest first. */
export async function listMonths(): Promise<BsMonth[]> {
  return respond(monthsKept().sort((a, b) => compareMonths(b, a)));
}

function ledgerFor(current: MockState, employee: Employee, month: BsMonth): MonthLedger | null {
  if (monthKey(month) < employee.joined.bs.slice(0, 7)) return null;
  const structure = structureFor(current.structures, employee.id, month);
  if (!structure) return null;
  const attendance = mockAttendance(employee.id, month);
  const rate = structure.pay_type === "monthly" ? structure.gross : structure.basic;
  const pay = structure.pay_type === "monthly"
    ? monthlyPay(rate, structure.ot_rate, attendance)
    : dailyPay(rate, structure.ot_rate, attendance);
  const payments = current.payments
    .filter((p) => p.employee_id === employee.id && sameMonth(p.month, month))
    .sort((a, b) => a.date.bs.localeCompare(b.date.bs) || a.id - b.id);
  const paid = settle(pay.net, payments);
  return {
    employee_id: employee.id,
    month,
    starts: monthStart(month),
    ends: monthEnd(month),
    in_progress: sameMonth(month, thisMonth()),
    pay_type: structure.pay_type,
    rate,
    ot_rate: structure.ot_rate,
    attendance,
    ...pay,
    ...paid,
    payments,
  };
}

/** GET /api/payroll/employees/{id}/ledger — newest month first. */
export async function getLedger(employee_id: number): Promise<MonthLedger[]> {
  const current = getState();
  const employee = findEmployee(employee_id);
  const rows = monthsKept()
    .map((month) => ledgerFor(current, employee, month))
    .filter((row): row is MonthLedger => row !== null)
    .sort((a, b) => compareMonths(b.month, a.month));
  return respond(rows);
}

/** GET /api/payroll/employees/{id}/ledger/{YYYY-MM} */
export async function getMonthLedger(employee_id: number, month: BsMonth): Promise<MonthLedger> {
  const current = getState();
  const row = ledgerFor(current, findEmployee(employee_id), month);
  if (!row) throw new PayrollApiError(404, "No salary for this month (before the joining date).");
  return respond(row);
}

/**
 * The month "Pay <month> salary" targets: last month while anything is still
 * due for it, otherwise the running month.
 */
export async function suggestPayMonth(employee_id: number): Promise<BsMonth> {
  const current = getState();
  const employee = findEmployee(employee_id);
  const previous = addMonths(thisMonth(), -1);
  const row = ledgerFor(current, employee, previous);
  return row && row.due > 0 ? previous : thisMonth();
}

// --------------------------------------------------------------- payments

/** GET /api/payroll/balance?employee_id=&bs_year=&bs_month= (cross-module, used by the attendance scan pop-up) */
export async function getBalance(employee_id: number, month: BsMonth): Promise<MonthBalance> {
  const current = getState();
  const employee = findEmployee(employee_id);
  const row = ledgerFor(current, employee, month);
  if (!row) throw new PayrollApiError(404, "No salary for this month (before the joining date).");
  return respond({
    employee_id,
    bs_year: month.bs_year,
    bs_month: month.bs_month,
    month_key: monthKey(month),
    month_label: monthLabel(month),
    net: row.net,
    paid: row.paid,
    due: row.due,
    status: row.status,
    breakdown: {
      gross_salary: row.gross_salary,
      overtime_pay: row.overtime_pay,
      absence_deduction: row.absence_deduction,
      tds: row.tds,
      salary_paid: row.salary_paid,
      advance_paid: row.advance_paid,
      in_progress: row.in_progress,
    },
  });
}

/** POST /api/payroll/payments (cross-module; 422 with `field` when amount is 0 or above due) */
export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  const current = getState();
  const employee = findEmployee(input.employee_id);
  const month = { bs_year: input.bs_year, bs_month: input.bs_month };
  if (compareMonths(month, thisMonth()) > 0) {
    throw new PayrollApiError(422, "That month has not started yet.", "month");
  }
  const row = ledgerFor(current, employee, month);
  if (!row) throw new PayrollApiError(404, "No salary for this month (before the joining date).");
  const amount = Number(input.amount);
  const problem = paymentError(amount, row.due);
  if (problem) throw new PayrollApiError(422, problem, "amount");
  if (input.type !== "salary" && input.type !== "advance") {
    throw new PayrollApiError(422, "Choose salary or advance.", "type");
  }
  if (input.mode !== "cash" && input.mode !== "bank") {
    throw new PayrollApiError(422, "Choose cash or bank.", "mode");
  }
  const date_bs = input.date_bs?.trim() || today().bs;
  if (!isValidBs(date_bs)) throw new PayrollApiError(422, "Enter the date as YYYY-MM-DD (BS).", "date_bs");
  if (date_bs > today().bs) throw new PayrollApiError(422, "The payment date cannot be in the future.", "date_bs");
  const payment: Payment = {
    id: nextId("payment"),
    employee_id: employee.id,
    month,
    type: input.type,
    amount,
    mode: input.mode,
    reference: input.mode === "bank" ? cleanOptional(input.reference) : null,
    note: cleanOptional(input.note),
    date: dateBoth(date_bs),
    recorded_by: MOCK_USER,
    source: input.source,
    created_at: new Date().toISOString(),
  };
  current.payments.push(payment);
  commit();
  return respond({ payment, due_after: Math.max(0, row.due - amount) });
}

export interface PaymentsQuery {
  /** null = every month kept. */
  month: BsMonth | null;
  type: RegisterTypeFilter;
  employee_id?: number | null;
}

/** GET /api/payroll/payments?bs_year=&bs_month=&type=&employee_id= — newest first. */
export async function listPayments(query: PaymentsQuery): Promise<PaymentsRegister> {
  const current = getState();
  const employeeById = new Map(current.employees.map((e) => [e.id, e]));
  const rows: RegisterRow[] = current.payments
    .filter((p) => query.month === null || sameMonth(p.month, query.month))
    .filter((p) => query.type === "all" || p.type === query.type)
    .filter((p) => !query.employee_id || p.employee_id === query.employee_id)
    .map((payment) => ({ payment, employee: employeeById.get(payment.employee_id)! }))
    .filter((row) => row.employee)
    .sort((a, b) => b.payment.date.bs.localeCompare(a.payment.date.bs) || b.payment.id - a.payment.id);
  const scopeMonth = query.month ?? thisMonth();
  const ledgers = current.employees
    .map((employee) => ledgerFor(current, employee, scopeMonth))
    .filter((row): row is MonthLedger => row !== null);
  const inScope = current.payments.filter((p) => query.month === null || sameMonth(p.month, query.month));
  return respond({
    month: query.month,
    rows,
    totals: {
      month_net: ledgers.reduce((sum, l) => sum + l.net, 0),
      salary_paid: inScope.filter((p) => p.type === "salary").reduce((sum, p) => sum + p.amount, 0),
      advance_paid: inScope.filter((p) => p.type === "advance").reduce((sum, p) => sum + p.amount, 0),
      due: ledgers.reduce((sum, l) => sum + l.due, 0),
      count: rows.length,
      amount: rows.reduce((sum, r) => sum + r.payment.amount, 0),
    },
  });
}

// ----------------------------------------------------------------- report

/** GET /api/payroll/report/{YYYY-MM}?department_id= */
export async function getSalaryReport(month: BsMonth, department_id: number | null = null): Promise<SalaryReport> {
  const current = getState();
  if (compareMonths(month, thisMonth()) > 0) throw new PayrollApiError(404, "That month has not started yet.");
  const allRows: ReportRow[] = current.employees
    .filter((e) => e.active || current.payments.some((p) => p.employee_id === e.id && sameMonth(p.month, month)))
    .map((employee) => ({ employee, ledger: ledgerFor(current, employee, month) }))
    .filter((row): row is ReportRow => row.ledger !== null);
  const rows = department_id === null ? allRows : allRows.filter((row) => row.employee.department?.id === department_id);
  const by_department: DepartmentNetTotal[] = current.departments
    .filter((d) => d.is_active)
    .map((department) => {
      const mine = allRows.filter((r) => r.employee.department?.id === department.id);
      return { department, staff: mine.length, net: mine.reduce((sum, r) => sum + r.ledger.net, 0) };
    });
  const trend: MonthNetTotal[] = monthsKept()
    .filter((m) => compareMonths(m, month) <= 0)
    .map((m) => ({
      month: m,
      net: current.employees
        .filter((e) => department_id === null || e.department?.id === department_id)
        .map((e) => ledgerFor(current, e, m))
        .reduce((sum, l) => sum + (l?.net ?? 0), 0),
    }));
  return respond({
    month,
    rows,
    totals: totalsFor(rows.map((r) => r.ledger)),
    by_department,
    trend,
    all_staff: allRows.length,
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

/** POST /api/payroll/photo-tokens {employee_id} — a 10-minute link the QR code encodes. */
export async function createPhotoToken(employee_id: number, origin: string): Promise<PhotoToken> {
  const current = getState();
  findEmployee(employee_id);
  pruneTokens(current);
  const token = randomToken();
  const expires_at = new Date(Date.now() + PHOTO_TOKEN_TTL_MS).toISOString();
  current.photo_tokens.push({ token, employee_id, expires_at });
  commit();
  return respond({ token, employee_id, url: `${origin}/people/photo/${token}`, expires_at });
}

/** GET /api/payroll/photo-tokens/{token} (no session; 410 when expired) */
export async function resolvePhotoToken(token: string): Promise<PhotoTokenInfo> {
  const current = getState();
  pruneTokens(current);
  const found = current.photo_tokens.find((t) => t.token === token);
  if (!found) throw new PayrollApiError(410, "This link has expired. Ask for a new QR code.");
  return respond({ employee: findEmployee(found.employee_id), expires_at: found.expires_at });
}

/** POST /api/payroll/photo-tokens/{token}/photo (multipart image, no session) */
export async function uploadPhotoByToken(token: string, photo: string): Promise<Employee> {
  const info = await resolvePhotoToken(token);
  return setEmployeePhoto(info.employee.id, photo);
}

// ----------------------------------------------------------------- misc

export { monthKey, parseMonthKey };
export type { Role };
