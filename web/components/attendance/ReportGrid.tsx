"use client";

import { Fragment } from "react";
import {
  WEEKDAY_NAMES_EN,
  bsDayLabel,
  formatAdShort,
  formatRate,
  isLowPresence,
  statusCode,
  statusLabel,
  weekdayInitial,
  type DepartmentGroup,
} from "./helpers";
import type { DayCell, DayHeader, ReportRow } from "./types";
import styles from "./report.module.css";

/** A department group on the page, with the whole-filter headcount and rate. */
export interface GridGroup extends DepartmentGroup {
  count: number;
}

export interface ReportGridProps {
  monthName: string;
  days: DayHeader[];
  /** Rows of the current page, in display order. */
  rows: ReportRow[];
  /** When grouping: the page's rows grouped, with whole-filter headcount/rate. */
  groups: GridGroup[] | null;
  /** Staff present per day for everyone in the filter (not just the page). */
  staffPresent: (number | null)[];
  /** Days nobody has marked yet: shown blank in the footer. */
  openDays: boolean[];
  staffCount: number;
  avgPresent: number;
  wide: boolean;
  emptyText?: string;
}

function cellTitle(monthName: string, day: DayHeader, cell: DayCell): string {
  const time = cell.in_time || cell.out_time ? ` ${cell.in_time ?? ""}–${cell.out_time ?? ""}` : "";
  return `${bsDayLabel(monthName, day)}: ${statusLabel(cell.status)}${time}`;
}

function Cell({ monthName, day, cell, wide }: { monthName: string; day: DayHeader; cell: DayCell; wide: boolean }) {
  const title = cellTitle(monthName, day, cell);
  if (wide) {
    const time = cell.in_time || cell.out_time ? `${cell.in_time ?? ""}–${cell.out_time ?? ""}` : "";
    return (
      <span className={styles.wcell} data-status={cell.status} title={title}>
        <span>{cell.status === "weekly_off" ? "Off" : cell.status === "not_marked" ? "·" : statusLabel(cell.status)}</span>
        {time ? <span className={styles.wcellTime}>{time}</span> : null}
        <span className="sr-only">{title}</span>
      </span>
    );
  }
  return (
    <span className={styles.cell} data-status={cell.status} title={title}>
      <span aria-hidden="true">{cell.status === "not_marked" ? "·" : statusCode(cell.status)}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function ReportGrid({
  monthName,
  days,
  rows,
  groups,
  staffPresent,
  openDays,
  staffCount,
  avgPresent,
  wide,
  emptyText = "No employees match this filter.",
}: ReportGridProps) {
  const span = days.length + 7;
  const renderRow = (row: ReportRow) => (
    <tr key={row.employee.id}>
      <th scope="row" className={styles.empCol}>
        <span className={styles.empName}>
          <span>{row.employee.name}</span>
          <span>
            {row.employee.code} · {row.employee.department_name}
          </span>
        </span>
      </th>
      {row.cells.map((cell, i) => (
        <td key={days[i].bs_date}>
          <Cell monthName={monthName} day={days[i]} cell={cell} wide={wide} />
        </td>
      ))}
      <td className={styles.tot}>{row.totals.present}</td>
      <td className={styles.tot}>{row.totals.late}</td>
      <td className={styles.tot}>{row.totals.half_day}</td>
      <td className={styles.tot}>{row.totals.leave}</td>
      <td className={styles.tot}>{row.totals.absent}</td>
      <td className={`${styles.tot} ${styles.totPaid}`}>{row.totals.paid_days}</td>
    </tr>
  );

  return (
    <section aria-label="Attendance grid" className={`card ${styles.gridCard}`}>
      <table className={styles.grid}>
        <caption className="sr-only">
          Attendance of {staffCount} employees, {monthName}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.empCol}>
              Employee
            </th>
            {days.map((day) => (
              <th
                key={day.bs_date}
                scope="col"
                className={`${wide ? styles.dayHeadWide : styles.dayHead} ${day.is_weekly_off ? styles.dayHeadOff : ""}`}
                title={`${bsDayLabel(monthName, day)} · ${formatAdShort(day.ad_date, true)} · ${WEEKDAY_NAMES_EN[day.weekday]}`}
              >
                <span className={styles.dayHeadInner}>
                  <span className={styles.dayNum}>{day.bs_day}</span>
                  <span className={styles.dayNp} lang="ne">
                    {weekdayInitial(day.weekday)}
                  </span>
                  {wide ? <span className={styles.dayAd}>{formatAdShort(day.ad_date)}</span> : null}
                </span>
              </th>
            ))}
            <th scope="col" className={styles.tot} title="Present">
              P
            </th>
            <th scope="col" className={styles.tot} title="Late">
              L
            </th>
            <th scope="col" className={styles.tot} title="Half day">
              H
            </th>
            <th scope="col" className={styles.tot} title="Leave">
              V
            </th>
            <th scope="col" className={styles.tot} title="Absent">
              A
            </th>
            <th scope="col" className={styles.tot}>
              Paid days
            </th>
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map((group) => (
                <Fragment key={group.department_id}>
                  <tr>
                    <th scope="rowgroup" colSpan={span} className={styles.deptHead}>
                      <span style={{ fontWeight: 600 }}>{group.department_name}</span>
                      <span>
                        {" "}
                        · {group.count} {group.count === 1 ? "employee" : "employees"} ·{" "}
                        {formatRate(group.rate)} attendance
                      </span>
                    </th>
                  </tr>
                  {group.rows.map(renderRow)}
                </Fragment>
              ))
            : rows.map(renderRow)}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={styles.footHead}>
              Staff present
            </th>
            {days.map((day, i) => {
              const n = staffPresent[i];
              const off = n === null;
              const open = !off && openDays[i];
              const cls = [
                styles.footCell,
                off || open ? styles.footOff : isLowPresence(n, staffCount) ? styles.footLow : "",
              ]
                .filter(Boolean)
                .join(" ");
              const title = off
                ? "Weekly off"
                : open
                  ? `${bsDayLabel(monthName, day)}: not marked yet`
                  : `${n} of ${staffCount} present on ${bsDayLabel(monthName, day)}`;
              return (
                <td key={day.bs_date} className={cls} title={title}>
                  {off ? "–" : open ? "·" : wide ? `${n} / ${staffCount}` : n}
                </td>
              );
            })}
            <td colSpan={6} className={styles.footNote}>
              avg {avgPresent.toFixed(1)} of {staffCount} per day
            </td>
          </tr>
        </tfoot>
      </table>
      {rows.length === 0 ? <p className={styles.emptyNote}>{emptyText}</p> : null}
    </section>
  );
}
