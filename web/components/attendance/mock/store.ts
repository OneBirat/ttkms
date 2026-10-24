/**
 * MOCK attendance records and payroll balances: in-memory maps seeded
 * deterministically so every screen shows the same data, and mutated by the
 * save / scan / payment calls. Replaced by attendance.records (and the payroll
 * module's tables) once the backend lands.
 */

import { diffDays, todayAd } from "../bsdate";
import type {
  AttendanceRecord,
  AttendanceSettings,
  DayHeader,
  MarkInput,
  MarkStatus,
  MonthBalance,
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

const extraPaid = new Map<string, number>();
let nextPaymentId = 1;

/** Sample month figures per employee, like the design's `payFor`. */
export function getBalance(employeeId: number, monthKey: string, monthLabel: string): MonthBalance {
  const i = employeeId - 1;
  const net = 18000 + ((i * 731) % 9000);
  const basePaid = Math.min([0, 5000, 8000][i % 3], net);
  const paid = basePaid + (extraPaid.get(`${employeeId}:${monthKey}`) ?? 0);
  return {
    employee_id: employeeId,
    month_key: monthKey,
    month_label: monthLabel,
    net,
    paid,
    due: Math.max(0, net - paid),
  };
}

export function addPayment(input: PaymentInput, monthLabel: string): PaymentResult {
  const k = `${input.employee_id}:${input.month_key}`;
  extraPaid.set(k, (extraPaid.get(k) ?? 0) + input.amount);
  const after = getBalance(input.employee_id, input.month_key, monthLabel);
  return {
    payment_id: nextPaymentId++,
    amount: input.amount,
    due_after: after.due,
    recorded_at: new Date().toISOString(),
  };
}

/** Test/support hook: forget every record and seed again on next read. */
export function resetMockStore(): void {
  records.clear();
  seeded.clear();
  extraPaid.clear();
  nextPaymentId = 1;
}
