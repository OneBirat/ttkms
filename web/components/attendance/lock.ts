/**
 * The attendance lock, as the screens show it. The API enforces every rule
 * (app/modules/attendance/services.py); this file only reads what the server said:
 * `DayAttendance.lock` for the day and `created_at` / `editable_until` / `locked` on a record.
 *
 * - today: marking works as always;
 * - a past day: nobody can be newly marked, and a mark can be changed or removed only for
 *   24 hours from when it was first saved;
 * - the super admin on a past day ("override"): everything works, each change asks for a reason.
 */

import { formatBs, kathmanduDateBs, kathmanduTime } from "@/lib/bs";
import type { AttendanceRecord, CellStatus, DayLock, MarkStatus } from "./types";

/** What one row allows: change it now, nothing, or change it as the super admin (with a reason). */
export type RowAccess = "edit" | "locked" | "override";

/** An override needs a reason of at least this many characters (the API checks it too). */
export const REASON_MIN = 5;
export const REASON_MAX = 300;

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
  if (lock.mode === "override") return "override";
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
  if (access === "override") return null;
  return editableUntilText(record, now);
}

/** "Present", "Overtime · 2 h", "Absent", "Not marked", "Weekly off". */
export function markText(status: CellStatus | null, hours = 0): string {
  switch (status) {
    case "P":
      return "Present";
    case "O":
      return `Overtime · ${hours} h`;
    case "A":
      return "Absent";
    case "W":
      return "Weekly off";
    default:
      return "Not marked";
  }
}

/** What an override changes, old → new: "Present → Absent", "Overtime · 2 h → Not marked". */
export function changeText(
  previous: CellStatus,
  previousHours: number,
  next: MarkStatus | null,
  nextHours: number,
  weeklyOff = false,
): string {
  const before = previous === "N" && weeklyOff ? "W" : previous;
  const after = next ?? (weeklyOff ? "W" : "N");
  return `${markText(before, previousHours)} → ${markText(after, nextHours)}`;
}

/** Why the reason cannot be sent yet, or null when it is long enough. */
export function reasonError(reason: string): string | null {
  return reason.trim().replace(/\s+/g, " ").length < REASON_MIN
    ? `Give a reason (at least ${REASON_MIN} characters).`
    : null;
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
