/**
 * The attendance lock, as the screens show it. The API enforces every rule
 * (app/modules/attendance/services.py); this file only reads what the server said:
 * `DayAttendance.lock` for the day and `created_at` / `editable_until` / `locked` on a record.
 *
 * - today: marking works as always;
 * - a past day: nobody can be newly marked, and a mark can be changed or removed only for
 *   24 hours from when it was first saved.
 */

import { formatBs, kathmanduDateBs, kathmanduTime } from "@/lib/bs";
import type { AttendanceRecord, DayLock } from "./types";

/** What one row allows: change it now, or nothing. */
export type RowAccess = "edit" | "locked";

type LockedFields = Pick<AttendanceRecord, "locked" | "editable_until">;

/** A mark is still inside its 24 hours (the server's `locked`, re-checked against the clock). */
export function isEditable(record: LockedFields, now: number = Date.now()): boolean {
  if (record.locked) return false;
  if (!record.editable_until) return true;
  const until = Date.parse(record.editable_until);
  return Number.isNaN(until) || now < until;
}

export function rowAccess(
  lock: DayLock | null | undefined,
  record: LockedFields | null | undefined,
  now: number = Date.now(),
): RowAccess {
  if (!lock || lock.mode === "open") return "edit";
  return record && isEditable(record, now) ? "edit" : "locked";
}

/** New marks and "Mark … as Present" work without a reason only on an open day. */
export function canBulk(lock: DayLock | null | undefined): boolean {
  return !lock || lock.can_create;
}

/** "9:45 AM" in Nepal time. */
export function clockText(timestamp: string): string {
  const { hour, minute } = kathmanduTime(timestamp);
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Editable until 9:45 AM, Kartik 16, 2083" for a mark inside its 24 hours, else null. */
export function editableUntilText(
  record: LockedFields | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!record || !record.editable_until || !isEditable(record, now)) return null;
  return `Editable until ${clockText(record.editable_until)}, ${formatBs(kathmanduDateBs(record.editable_until))}`;
}

export const LOCKED_MARK = "Locked · only the super admin can change it.";

/** The line under a mark in its ⋮ sheet / detail: the deadline, or that it is locked. */
export function lockLine(
  lock: DayLock | null | undefined,
  record: LockedFields | null | undefined,
  now: number = Date.now(),
): string | null {
  const access = rowAccess(lock, record, now);
  if (access === "locked") return LOCKED_MARK;
  return editableUntilText(record, now);
}

/** True for the API's 403 `attendance_locked` (the window closed while the screen was open). */
export function isLockedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "attendance_locked"
  );
}
