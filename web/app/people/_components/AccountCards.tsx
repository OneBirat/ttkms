"use client";

import { useMemo, useState } from "react";
import { formatBs } from "@/lib/bs";
import { currentMonth, getAttendanceMonth, getSalaryDues } from "../api";
import { calendarBounds, calendarChips, calendarWeeks, stepMonth, type CalendarDay } from "../_lib/account";
import { compareMonths, monthLabel, today } from "../_lib/months";
import { formatAmount } from "../_lib/helpers";
import type { Employee, SalaryStructure } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./account.module.css";
import shared from "./payroll.module.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Salary tab, left card: the employee's attendance for one BS month as a Sun-Sat grid (data from
 * the attendance module's employee month), ‹ › from the joining month to the running month. No
 * money from attendance; the bottom line is the salary structure and, for salary_advances, the
 * employee's total due (DuePill).
 */
export function AttendanceCalendarCard({
  employee,
  structure,
  showDue,
}: {
  employee: Employee;
  structure: SalaryStructure | null;
  /** salary_advances: the total-due pill in the footer. */
  showDue: boolean;
}) {
  const now = currentMonth();
  const bounds = calendarBounds(employee.joined.bs, now);
  const [month, setMonth] = useState(now);
  const data = usePayroll(() => getAttendanceMonth(employee.id, month), [employee.id, month.bs_year, month.bs_month]);
  const todayBs = today().bs;
  const weeks = useMemo(() => {
    const m = data.data;
    if (!m) return [];
    return calendarWeeks(
      m.month.days.map((d, i) => ({ ...d, status: m.cells[i]?.status ?? "N", ot_hours: m.cells[i]?.ot_hours ?? 0 })),
      todayBs,
      employee.joined.bs,
    );
  }, [data.data, todayBs, employee.joined.bs]);
  const chips = calendarChips(weeks);
  const atMin = compareMonths(month, bounds.min) <= 0;
  const atMax = compareMonths(month, bounds.max) >= 0;
  const label = monthLabel(month);

  return (
    <section aria-labelledby="att-cal-h" className={`card ${styles.calCard}`} data-testid="attendance-card">
      <div className={styles.calHead}>
        <h3 id="att-cal-h" className={shared.cardTitle}>
          Attendance · <span data-testid="attendance-month">{label}</span>
        </h3>
        <div className={styles.calNav}>
          <button type="button" className={styles.calNavBtn} aria-label="Previous month" disabled={atMin} onClick={() => setMonth(stepMonth(month, -1, bounds))}>
            ‹
          </button>
          <button type="button" className={styles.calNavBtn} aria-label="Next month" disabled={atMax} onClick={() => setMonth(stepMonth(month, 1, bounds))}>
            ›
          </button>
        </div>
      </div>

      <div className={styles.calChips} aria-label="Month summary">
        <span className={styles.calChip} data-mark="P">
          Present <b>{chips.present}</b>
        </span>
        <span className={styles.calChip} data-mark="O">
          Overtime <b>{chips.overtime}</b> · {chips.hours} h
        </span>
        <span className={styles.calChip} data-mark="A">
          Absent <b>{chips.absent}</b>
        </span>
        <span className={styles.calChip} data-mark="W">
          Saturday <b>{chips.saturday}</b>
        </span>
      </div>

      {data.error ? (
        <p className={shared.muted} role="status">
          {payrollErrorMessage(data.error)}
        </p>
      ) : !data.data ? (
        <p className={shared.muted} role="status">
          Loading…
        </p>
      ) : (
        <table className={styles.cal} aria-label={`Attendance ${label}`}>
          <thead>
            <tr>
              {WEEKDAYS.map((d, i) => (
                <th key={d} scope="col" className={i === 6 ? styles.calSat : undefined}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((day, i) => (
                  <td key={day?.bs_date ?? `pad-${w}-${i}`}>{day ? <DayCell day={day} /> : null}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.calFoot}>
        <span className={shared.note}>
          {structure
            ? `${structure.pay_type === "daily" ? "Wage" : "Salary"} Rs ${formatAmount(structure.pay_type === "daily" ? structure.basic : structure.gross)} / ${structure.pay_type === "daily" ? "day" : "month"} · OT Rs ${formatAmount(structure.ot_rate)} / h`
            : "No salary set up yet"}
        </span>
        {showDue ? <DuePill employeeId={employee.id} /> : null}
      </div>
    </section>
  );
}

function DayCell({ day }: { day: CalendarDay }) {
  const text = day.mark === "O" ? `O ${day.ot_hours}h` : day.mark;
  const title = `${formatBs(day.bs_date)} · ${day.ad_date}${day.mark ? ` · ${text}` : ""}`;
  return (
    <div className={styles.calDay} data-today={day.today ? "true" : undefined} data-sat={day.saturday ? "true" : undefined} title={title} data-bs={day.bs_date}>
      <span className={styles.calNums}>
        <span className={styles.calBs}>{day.bs_day}</span>
        <span className={styles.calAd}>{day.ad_label}</span>
      </span>
      {day.mark ? (
        <span className={styles.calMark} data-mark={day.mark}>
          {text}
        </span>
      ) : null}
    </div>
  );
}

/** "Due 28,230" (red) or "No dues ✓" (green). */
export function duePill(total: number): { text: string; owing: boolean } {
  return total > 0 ? { text: `Due ${formatAmount(total)}`, owing: true } : { text: "No dues ✓", owing: false };
}

/**
 * The employee's total due - the same figure as the Pay salary dialog (GET .../salary-dues
 * total_due: every past month still due + the running month up to earned so far − everything paid).
 */
export function DuePill({ employeeId }: { employeeId: number }) {
  const dues = usePayroll(() => getSalaryDues(employeeId), [employeeId]);
  if (!dues.data) return null;
  const pill = duePill(dues.data.total_due);
  return (
    <span className={styles.duePill} data-owing={pill.owing} data-testid="due-pill">
      {pill.text}
    </span>
  );
}
