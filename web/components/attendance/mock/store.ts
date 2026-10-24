/**
 * MOCK attendance records and payroll balances: in-memory maps seeded
 * deterministically so every screen shows the same data, and mutated by the
 * save / scan / payment calls. Replaced by attendance.records (and the payroll
 * module's tables) once the backend lands.
 */

import { adToBs, diffDays, isoBs, todayAd } from "../bsdate";
import type {
  AttendanceRecord,
  AttendanceSettings,
  DayHeader,
  MarkInput,
  MarkStatus,
  MonthBalance,
  PaymentEntry,
  PaymentHistory,
  PaymentInput,
  PaymentResult,
} from "../types";
import { EMPLOYEES } from "./employees";

export const MOCK_SETTINGS: AttendanceSettings = { weekly_off: 6 };

const records = new Map<string, AttendanceRecord>();
const seeded = new Set<string>();

const key = (employeeId: number, ad: string) => `${employeeId}:${ad}`;

/** Deterministic 0-99 hash of an employee and a day. */
function hash(employeeId: number, dayOrdinal: number): number {
  const i = employeeId - 1;
  return (i * 37 + dayOrdinal * 17 + i * dayOrdinal * 7 + 13) % 100;
}

/** The design's sample day: a share still open, a few absent, some overtime. */
function seedToday(employeeId: number): { status: MarkStatus; ot_hours: number } | null {
  const i = employeeId - 1;
  const t = (i * 41 + 13) % 100;
  if (t < 18) return null;
  if (t >= 26 && t < 32) return { status: "A", ot_hours: 0 };
  const ot = (i * 17) % 9 === 0 ? 2 : (i * 17) % 9 === 4 ? 1 : 0;
  return ot ? { status: "O", ot_hours: ot } : { status: "P", ot_hours: 0 };
}

function seedPast(employeeId: number, ordinal: number): { status: MarkStatus; ot_hours: number } | null {
  const h = hash(employeeId, ordinal);
  if (h < 2) return null; // the odd day nobody got round to marking
  if (h < 6) return { status: "A", ot_hours: 0 };
  if (h < 16) return { status: "O", ot_hours: 1 + (h % 3) };
  return { status: "P", ot_hours: 0 };
}

function seedDay(day: DayHeader): void {
  if (seeded.has(day.ad_date)) return;
  seeded.add(day.ad_date);
  if (day.is_weekly_off) return;
  const offset = diffDays(todayAd(), day.ad_date);
  if (offset > 0) return; // future: nothing marked yet
  const ordinal = diffDays("2026-01-01", day.ad_date);
  for (const employee of EMPLOYEES) {
    const mark = offset === 0 ? seedToday(employee.id) : seedPast(employee.id, ordinal);
    if (!mark) continue;
    records.set(key(employee.id, day.ad_date), {
      employee_id: employee.id,
      date_bs: day.bs_date,
      date_ad: day.ad_date,
      status: mark.status,
      ot_hours: mark.ot_hours,
      note: "",
      marked_by: "admin",
      marked_via: "manual",
      updated_at: `${day.ad_date}T18:05:00+05:45`,
    });
  }
}

export function getRecord(employeeId: number, day: DayHeader): AttendanceRecord | null {
  seedDay(day);
  return records.get(key(employeeId, day.ad_date)) ?? null;
}

export function putMarks(
  day: DayHeader,
  marks: readonly MarkInput[],
  markedBy: string,
  via: AttendanceRecord["marked_via"],
): AttendanceRecord[] {
  seedDay(day);
  const now = new Date().toISOString();
  return marks.map((mark) => {
    const record: AttendanceRecord = {
      employee_id: mark.employee_id,
      date_bs: day.bs_date,
      date_ad: day.ad_date,
      status: mark.status,
      ot_hours: mark.status === "O" ? mark.ot_hours : 0,
      note: mark.note,
      marked_by: markedBy,
      marked_via: via,
      updated_at: now,
    };
    records.set(key(mark.employee_id, day.ad_date), record);
    return record;
  });
}

// ------------------------------------------------------------ payroll (mock)

const sessionPayments = new Map<string, PaymentEntry[]>();
let nextPaymentId = 1000;

/** Base figures per employee, like the design's `payFor`: a third have paid nothing, a third 5,000, a third 8,000. */
function basePaidOf(employeeId: number, net: number): number {
  return Math.min([0, 5000, 8000][(employeeId - 1) % 3], net);
}

/** The design's sample payments behind the base amounts (HISTB). */
const SEED_HISTORY: Record<number, [day: number, type: PaymentEntry["type"], amount: number, note: string][]> = {
  5000: [
    [4, "advance", 2000, "Cash"],
    [11, "advance", 3000, "Cash"],
  ],
  8000: [
    [3, "advance", 2000, "Cash"],
    [9, "advance", 1500, "Cash"],
    [15, "salary", 4500, "Part salary"],
  ],
};

function seededPayments(employeeId: number, monthKey: string, net: number): PaymentEntry[] {
  const [year, month] = monthKey.split("-").map(Number);
  const rows = SEED_HISTORY[basePaidOf(employeeId, net)] ?? [];
  return rows.map(([day, type, amount, note], i) => ({
    id: employeeId * 100 + i + 1,
    bs_date: isoBs(year, month, day),
    type,
    amount,
    method: "cash",
    note,
    created_at: `2026-10-${String(17 + day).padStart(2, "0")}T10:00:00+05:45`,
  }));
}

function netOf(employeeId: number): number {
  return 18000 + (((employeeId - 1) * 731) % 9000);
}

export function getBalance(employeeId: number, monthKey: string, monthLabel: string): MonthBalance {
  const net = netOf(employeeId);
  const extra = (sessionPayments.get(`${employeeId}:${monthKey}`) ?? []).reduce((a, p) => a + p.amount, 0);
  const paid = basePaidOf(employeeId, net) + extra;
  return {
    employee_id: employeeId,
    month_key: monthKey,
    month_label: monthLabel,
    net,
    paid,
    due: Math.max(0, net - paid),
  };
}

/** Payments of the month, newest first (session payments on top). */
export function getPaymentHistory(employeeId: number, monthKey: string, monthLabel: string): PaymentHistory {
  const balance = getBalance(employeeId, monthKey, monthLabel);
  const seeded = seededPayments(employeeId, monthKey, balance.net);
  const session = sessionPayments.get(`${employeeId}:${monthKey}`) ?? [];
  const payments = [...session, ...seeded].sort((a, b) =>
    b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id,
  );
  return {
    employee_id: employeeId,
    month_key: monthKey,
    month_label: monthLabel,
    payments,
    totals: { paid: balance.paid, net: balance.net, due: balance.due },
  };
}

export function addPayment(input: PaymentInput, monthLabel: string): PaymentResult {
  const k = `${input.employee_id}:${input.month_key}`;
  const now = new Date();
  const todayBs = adToBs(todayAd(now));
  const entry: PaymentEntry = {
    id: nextPaymentId++,
    bs_date: isoBs(todayBs.year, todayBs.month, todayBs.day),
    type: input.type,
    amount: input.amount,
    method: input.method,
    note: input.method === "cash" ? "Cash" : "Bank transfer",
    created_at: now.toISOString(),
  };
  sessionPayments.set(k, [entry, ...(sessionPayments.get(k) ?? [])]);
  const after = getBalance(input.employee_id, input.month_key, monthLabel);
  return {
    payment_id: entry.id,
    amount: input.amount,
    due_after: after.due,
    recorded_at: entry.created_at,
  };
}

/** Test/support hook: forget every record and seed again on next read. */
export function resetMockStore(): void {
  records.clear();
  seeded.clear();
  sessionPayments.clear();
  nextPaymentId = 1000;
}
