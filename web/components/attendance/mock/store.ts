/**
 * MOCK attendance records: an in-memory map seeded deterministically per
 * (employee, day) so every page shows the same data, and mutated by the save
 * endpoint. Replaced by attendance.records next session.
 */

import type {
  AttendanceRecord,
  AttendanceSettings,
  AttendanceStatus,
  DayHeader,
  MarkInput,
} from "../types";
import { minutesToTime } from "../helpers";
import { diffDays, mockToday } from "./calendar";

export const MOCK_SETTINGS: AttendanceSettings = { late_after: "09:30", weekly_off: 6 };

const records = new Map<string, AttendanceRecord>();
const seeded = new Set<string>();

const key = (employeeId: number, ad: string) => `${employeeId}:${ad}`;

/** Deterministic 0-99 hash of an employee and a day. */
function hash(employeeId: number, dayOrdinal: number): number {
  const i = employeeId - 1;
  return (i * 37 + dayOrdinal * 17 + i * dayOrdinal * 7 + 13) % 100;
}

function seededStatus(employeeId: number, day: DayHeader, todayAd: string): AttendanceStatus | null {
  const offset = diffDays(todayAd, day.ad_date);
  if (offset > 0) return null; // future: nothing marked yet
  const ordinal = diffDays("2026-01-01", day.ad_date);
  const h = hash(employeeId, ordinal);
  if (offset === 0) {
    // Today: a share is still open, like the design's sample day.
    const t = ((employeeId - 1) * 41 + 13) % 100;
    if (t < 18) return null;
    return t < 26 ? "late" : t < 29 ? "absent" : t < 32 ? "leave" : t < 34 ? "half_day" : "present";
  }
  if (h < 2) return null; // the odd day nobody got round to marking
  return h < 5 ? "absent" : h < 14 ? "late" : h < 16 ? "half_day" : h < 19 ? "leave" : "present";
}

export function seededTimes(
  employeeId: number,
  day: DayHeader,
  status: AttendanceStatus,
): { in_time: string | null; out_time: string | null } {
  const h = hash(employeeId, diffDays("2026-01-01", day.ad_date));
  switch (status) {
    case "present":
      return { in_time: minutesToTime(530 + (h % 14)), out_time: minutesToTime(1040 + (h % 30)) };
    case "late":
      return { in_time: minutesToTime(575 + (h % 40)), out_time: minutesToTime(1045 + (h % 25)) };
    case "half_day":
      return { in_time: minutesToTime(535 + (h % 10)), out_time: minutesToTime(780 + (h % 20)) };
    default:
      return { in_time: null, out_time: null };
  }
}

function seedDay(day: DayHeader, employeeIds: readonly number[]): void {
  if (seeded.has(day.ad_date)) return;
  seeded.add(day.ad_date);
  if (day.is_weekly_off) return;
  const todayAd = mockToday().ad_date;
  for (const id of employeeIds) {
    const status = seededStatus(id, day, todayAd);
    if (!status) continue;
    records.set(key(id, day.ad_date), {
      employee_id: id,
      date: day.ad_date,
      bs_date: day.bs_date,
      status,
      ...seededTimes(id, day, status),
      note: "",
      marked_by: "admin",
      updated_at: `${day.ad_date}T18:05:00+05:45`,
    });
  }
}

export function getRecord(
  employeeId: number,
  day: DayHeader,
  employeeIds: readonly number[],
): AttendanceRecord | null {
  seedDay(day, employeeIds);
  return records.get(key(employeeId, day.ad_date)) ?? null;
}

export function putMarks(
  day: DayHeader,
  marks: readonly MarkInput[],
  markedBy: string,
  employeeIds: readonly number[],
): AttendanceRecord[] {
  seedDay(day, employeeIds);
  const now = new Date().toISOString();
  return marks.map((mark) => {
    const record: AttendanceRecord = {
      employee_id: mark.employee_id,
      date: day.ad_date,
      bs_date: day.bs_date,
      status: mark.status,
      in_time: mark.in_time,
      out_time: mark.out_time,
      note: mark.note,
      marked_by: markedBy,
      updated_at: now,
    };
    records.set(key(mark.employee_id, day.ad_date), record);
    return record;
  });
}

/** Test/support hook: forget every record and seed again on next read. */
export function resetMockStore(): void {
  records.clear();
  seeded.clear();
}
