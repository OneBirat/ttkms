import type { MonthSummary } from "../types";
import shared from "./payroll.module.css";

/**
 * A month's attendance counts in one line: Present · Overtime · Absent · Not marked. "Not
 * marked" (past working days without a record - unpaid, like absent) is red when there are any.
 * `short` = "P 22 · O 1 · A 1 · Not marked 3" for table rows.
 */
export function AttendanceCounts({ attendance: a, short = false, className }: { attendance: MonthSummary; short?: boolean; className?: string }) {
  const notMarked = a.not_marked ?? 0;
  return (
    <span className={`${shared.attCounts} ${className ?? ""}`} data-testid="attendance-counts">
      <span>
        {short ? "P" : "Present"} <b>{a.present}</b>
      </span>
      <span>
        {short ? "O" : "Overtime"} <b>{a.overtime_days}</b>
      </span>
      <span>
        {short ? "A" : "Absent"} <b>{a.absent}</b>
      </span>
      <span className={shared.attNotMarked} data-any={notMarked > 0 || undefined} title="Past working days without an attendance record: not paid">
        Not marked <b>{notMarked}</b>
      </span>
    </span>
  );
}
