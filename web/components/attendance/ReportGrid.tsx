"use client";

import { Fragment } from "react";
import { WEEKDAY_NAMES_EN, formatAdShort, weekdayInitial } from "./bsdate";
import { bsDayLabel, cellText, formatRate, initials, isLowPresence, type DepartmentGroup } from "./helpers";
import { photoTint } from "./MarkRow";
import type { DayCell, DayHeader, ReportRow } from "./types";
import styles from "./report.module.css";

/** A department group on the page, with the whole-filter headcount and rate. */
export interface GridGroup extends DepartmentGroup {
  count: number;
}

export type GridMode = "month" | "week" | "day";

export interface ReportGridProps {
  monthName: string;
  /** The day columns in view (a month, a week, or one day; Saturdays may be hidden). */
  days: DayHeader[];
  /** Rows of the current page, in display order; cells already match `days`. */
  rows: ReportRow[];
  /** When grouping: the page's rows grouped, with whole-filter headcount/rate. */
  groups: GridGroup[] | null;
  /** Staff present per day for everyone in the filter (not just the page). */
  staffPresent: (number | null)[];
  /** Days nobody has marked yet: shown blank in the footer. */
  openDays: boolean[];
  staffCount: number;
  mode: GridMode;
  photos: boolean;
  payIcons: boolean;
  emptyText?: string;
}

function Tick({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Bank-note: salary taken that day. */
export function SalaryGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="9" width="16" height="10" rx="1.5" />
      <circle cx="10" cy="14" r="2" />
      <path d="M5 6.5h15.5a1 1 0 0 1 1 1V15" />
    </svg>
  );
}

/** Wallet card: advance taken that day. */
export function AdvanceGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

function PayBadges({ cell }: { cell: DayCell }) {
  return (
    <span className={styles.payBadges} aria-hidden="true">
      {cell.salary ? (
        <span className={`${styles.payBadge} ${styles.payBadgeSal}`}>
          <SalaryGlyph />
        </span>
      ) : null}
      {cell.advance ? (
        <span className={`${styles.payBadge} ${styles.payBadgeAdv}`}>
          <AdvanceGlyph />
        </span>
      ) : null}
    </span>
  );
}

function cellTitle(monthName: string, day: DayHeader, cell: DayCell, payIcons: boolean): string {
  let title = `${bsDayLabel(monthName, day)}: ${cellText(cell)}`;
  if (payIcons && cell.salary) title += ` · salary Rs ${cell.salary.toLocaleString("en-IN")}`;
  if (payIcons && cell.advance) title += ` · advance Rs ${cell.advance.toLocaleString("en-IN")}`;
  return title;
}

function Cell({
  monthName,
  day,
  cell,
  wide,
  payIcons,
}: {
  monthName: string;
  day: DayHeader;
  cell: DayCell;
  wide: boolean;
  payIcons: boolean;
}) {
  const title = cellTitle(monthName, day, cell, payIcons);
  const pay = payIcons && cell.status !== "W" && cell.status !== "N" && (!!cell.advance || !!cell.salary);
  if (wide) {
    return (
      <span className={styles.wcell} data-status={cell.status} title={title}>
        <span className={styles.wcellMain}>
          {cell.status === "P" ? <Tick size={14} /> : null}
          <span>
            {cell.status === "P" ? "Present" : cell.status === "O" ? "Overtime" : cell.status === "A" ? "Absent" : cell.status === "W" ? "Off" : "·"}
          </span>
        </span>
        {cell.status === "O" ? <span className={styles.wcellHours}>+{cell.ot_hours} h</span> : null}
        {pay ? <PayBadges cell={cell} /> : null}
        <span className="sr-only">{title}</span>
      </span>
    );
  }
  return (
    <span className={styles.cell} data-status={cell.status} title={title}>
      <span aria-hidden="true" className={styles.cellCode}>
        {cell.status === "P" ? (pay ? null : <Tick />) : cell.status === "O" ? `${cell.ot_hours}h` : cell.status === "A" ? "A" : cell.status === "W" ? "–" : "·"}
      </span>
      {pay ? <PayBadges cell={cell} /> : null}
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
  mode,
  photos,
  payIcons,
  emptyText = "No employees match this filter.",
}: ReportGridProps) {
  const wide = mode !== "month";
  const dayView = mode === "day";
  const totalCols = dayView ? 2 : 5;
  const span = days.length + 1 + totalCols;
  const renderRow = (row: ReportRow) => (
    <tr key={row.employee.id}>
      <th scope="row" className={styles.empCol}>
        <span className={styles.empCell}>
          {photos ? (
            <span role="img" aria-label={`Photo of ${row.employee.name}`} className={styles.empPhoto} style={{ background: photoTint(row.employee.id) }}>
              {initials(row.employee.name)}
            </span>
          ) : null}
          <span className={styles.empName}>
            <span>{row.employee.name}</span>
            <span>
              {row.employee.code} · {row.employee.department_name}
            </span>
          </span>
        </span>
      </th>
      {row.cells.map((cell, i) => (
        <td key={days[i].bs_date}>
          <Cell monthName={monthName} day={days[i]} cell={cell} wide={wide} payIcons={payIcons} />
        </td>
      ))}
      <td className={styles.tot}>{row.totals.present + row.totals.overtime_days}</td>
      <td className={`${styles.tot} ${styles.totOt}`}>{row.totals.overtime_hours}h</td>
      {!dayView ? (
        <>
          <td className={styles.tot}>{row.totals.absent}</td>
          <td className={styles.tot}>{row.totals.weekly_off}</td>
          <td className={`${styles.tot} ${styles.totPaid}`}>{row.totals.paid_days}</td>
        </>
      ) : null}
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
            <th scope="col" className={styles.tot} title="Present days (incl. overtime days)">
              P
            </th>
            <th scope="col" className={styles.tot} title="Overtime hours">
              O
            </th>
            {!dayView ? (
              <>
                <th scope="col" className={styles.tot} title="Absent days">
                  A
                </th>
                <th scope="col" className={styles.tot} title="Weekly off days">
                  W
                </th>
                <th scope="col" className={styles.tot}>
                  Paid days
                </th>
              </>
            ) : null}
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
              const full = !off && !open && staffCount > 0 && n === staffCount;
              const cls = [
                styles.footCell,
                off || open ? styles.footOff : full ? styles.footFull : isLowPresence(n, staffCount) ? styles.footLow : "",
              ]
                .filter(Boolean)
                .join(" ");
              const title = off
                ? "Weekly off"
                : open
                  ? `${bsDayLabel(monthName, day)}: not marked yet`
                  : `${n} of ${staffCount} present on ${bsDayLabel(monthName, day)}${full ? " · everyone" : ""}`;
              return (
                <td key={day.bs_date} className={cls} title={title}>
                  {off ? "–" : open ? "·" : wide ? `${n} / ${staffCount}` : n}
                </td>
              );
            })}
            <td colSpan={totalCols} className={styles.footNote}>
              {staffCount} {staffCount === 1 ? "employee" : "employees"}
            </td>
          </tr>
        </tfoot>
      </table>
      {rows.length === 0 ? <p className={styles.emptyNote}>{emptyText}</p> : null}
    </section>
  );
}
