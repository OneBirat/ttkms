"use client";

import type { DayAttendance } from "./types";
import styles from "./lock.module.css";

/**
 * Above the staff list on a day nobody has to be marked: "Public holiday: Tihar" (amber) or
 * "Weekly off" (grey). Marking Present / Overtime still works - only for staff who came in.
 */
export function DayBanner({ data, phone = false }: { data: DayAttendance | null | undefined; phone?: boolean }) {
  if (!data) return null;
  const holiday = data.holiday ?? null;
  if (!holiday && !data.day.is_weekly_off) return null;
  return (
    <div role="status" className={styles.banner} data-mode={holiday ? "holiday" : "off"} data-phone={phone || undefined} data-testid="day-banner">
      <span className={styles.text}>
        {holiday ? (
          <>
            <b>Public holiday: {holiday.name}</b>
            {holiday.is_paid ? "" : " (unpaid)"} · nobody needs a mark; mark only staff who came in.
          </>
        ) : (
          <>
            <b>Weekly off</b> (Saturday) · nobody needs a mark; mark only staff who came in.
          </>
        )}
      </span>
    </div>
  );
}

/** A public holiday or the weekly off: nobody counts as "not marked" that day. */
export function isOffDay(data: Pick<DayAttendance, "day" | "holiday"> | null | undefined): boolean {
  return Boolean(data && (data.holiday || data.day.is_weekly_off));
}
