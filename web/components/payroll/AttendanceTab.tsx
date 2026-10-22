"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { currentMonth, getAttendance, listPayrollMonths } from "./api";
import { monthKey, monthLabel, parseMonthKey } from "./calendar";
import { formatDays } from "./helpers";
import { PayrollIcon } from "./icons";
import type { EmployeeProfile } from "./types";
import { payrollErrorMessage, usePayroll } from "./usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

/** This employee's MonthSummary from the AttendanceSummary contract. */
export function AttendanceTab({ employee }: { employee: EmployeeProfile }) {
  const selectId = useId();
  const [key, setKey] = useState(monthKey(currentMonth()));
  const months = usePayroll(listPayrollMonths, []);
  const month = parseMonthKey(key) ?? currentMonth();
  const attendance = usePayroll(() => getAttendance(employee.id, month), [employee.id, key]);
  const summary = attendance.data?.summary;

  const cards: { label: string; value: string; hint?: string }[] = summary
    ? [
        { label: "Present", value: formatDays(summary.present), hint: "half days count ½" },
        { label: "Late", value: String(summary.late), hint: "arrivals after the grace time" },
        { label: "Half days", value: String(summary.half_days) },
        { label: "Leave", value: String(summary.leave), hint: "paid for monthly staff" },
        { label: "Absent", value: String(summary.absent), hint: "unpaid" },
        { label: "Weekly off", value: String(summary.weekly_off), hint: "Saturdays, paid" },
        {
          label: "Paid days",
          value: `${formatDays(summary.paid_days)} / ${summary.days_in_month}`,
          hint: "days in month − absent − ½ × half days",
        },
      ]
    : [];

  return (
    <section aria-label="Attendance" className={shared.stack}>
      <div className={shared.between}>
        <div className={shared.row}>
          <label htmlFor={selectId} className={shared.fieldLabel}>
            Month (BS)
          </label>
          <div className={`field ${shared.selectWrap}`} style={{ width: 170 }}>
            <select id={selectId} value={key} onChange={(event) => setKey(event.target.value)}>
              {(months.data ?? [currentMonth()]).map((m) => (
                <option key={monthKey(m)} value={monthKey(m)}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Link
          href={`/attendance?employee=${employee.id}&month=${key}`}
          className="btn"
        >
          Attendance report
          <PayrollIcon name="external" size={16} />
        </Link>
      </div>
      {attendance.error ? (
        <p className={shared.danger}>{payrollErrorMessage(attendance.error)}</p>
      ) : !summary ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <div className={styles.attGrid}>
          {cards.map((card) => (
            <div key={card.label} className={`card ${styles.attCard}`}>
              <span className={styles.attLabel}>{card.label}</span>
              <span className={styles.attValue}>{card.value}</span>
              {card.hint ? <span className={styles.attHint}>{card.hint}</span> : null}
            </div>
          ))}
        </div>
      )}
      <p className={shared.note}>
        Figures come from the attendance module&apos;s month summary for {monthLabel(month)} (sample data
        until the attendance module is live). Payroll uses paid days for monthly staff and days present
        for daily wages.
      </p>
    </section>
  );
}
