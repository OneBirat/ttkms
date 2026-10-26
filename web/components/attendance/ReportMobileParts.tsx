"use client";

import { useId, type CSSProperties } from "react";
import { WEEKDAYS_SHORT_EN, formatAdShort, kathmanduTime } from "@/lib/bs";
import { filterReportRows } from "./exportModel";
import { computeTotals, groupByDepartment, sortRows, type DepartmentGroup } from "./helpers";
import { ChevronDownIcon, MenuIcon } from "./icons";
import {
  MOBILE_VIEWS,
  PALE_COLOUR,
  STRIP_COLOUR,
  STRIP_OUTLINE,
  calendarMark,
  cellLook,
  clockText,
  dayPillText,
  weekMark,
  type CellLook,
  type MobileView,
} from "./reportPeriod";
import type { AttendanceRecord, BranchRef, DayHeader, MonthReport, ReportFilters, ReportRow } from "./types";
import { useDialog } from "./useDialog";
import { FaceContent } from "./Face";
import styles from "./reportMobile.module.css";

/*
 * Pieces of the phone Attendance report (ReportMobile): header, month / week / day rows,
 * legend and the download sheet. No routing or session here, so the node tests render them.
 */

// ------------------------------------------------------------ pure pieces (tested)

export interface DeptChip {
  id: number | null;
  name: string;
  count: number;
}

/** "All 16", then every department of the branch with its staff count. */
export function departmentChips(report: MonthReport): DeptChip[] {
  return [
    { id: null, name: "All", count: report.rows.length },
    ...report.departments.map((d) => ({
      id: d.id,
      name: d.name,
      count: report.rows.filter((r) => r.employee.department_id === d.id).length,
    })),
  ];
}

/** Rows of the department chip and search (name or ID), grouped by department in branch order. */
export function mobileGroups(
  report: MonthReport,
  departmentId: number | null,
  query: string,
  employeeId: number | null = null,
): DepartmentGroup[] {
  const filters: ReportFilters = {
    month: report.month.key,
    branch_id: null,
    department_id: departmentId,
    query,
    sort: "dept",
    group: true,
    employee_id: employeeId,
  };
  const order = report.departments.map((d) => d.id);
  return groupByDepartment(sortRows(filterReportRows(report, filters), "dept", true, order));
}

/** Inline colours of a strip block (one per day of the month). */
export function stripStyle(look: CellLook): CSSProperties {
  const outline = STRIP_OUTLINE[look];
  return {
    background: STRIP_COLOUR[look],
    boxShadow: outline ? `inset 0 0 0 ${look === "N" ? 1.5 : 1}px ${outline}` : undefined,
  };
}

/** Inline colours of a calendar / week / day cell. */
export function paleStyle(look: CellLook, isToday: boolean): CSSProperties {
  const { bg, fg } = PALE_COLOUR[look];
  const border = look === "F" ? "1px dashed #E2E5E1" : look === "N" ? "1px dashed #C0392B" : "1px solid transparent";
  return { background: bg, color: fg, border, boxShadow: isToday ? "0 0 0 2px #0E6B6B" : undefined };
}

// ------------------------------------------------------------ header

export interface MobileHeaderProps {
  subtitle: string;
  /** see_other_branches: the branch pill lists every branch; without it there is no pill. */
  canPickBranch: boolean;
  branches: BranchRef[];
  branchId: number | null;
  onBranch: (id: number) => void;
  onMenu: () => void;
  onDownload: () => void;
  title: string;
  sub: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  view: MobileView;
  onView: (view: MobileView) => void;
}

export function MobileHeader(props: MobileHeaderProps) {
  const branch = props.branches.find((b) => b.id === props.branchId);
  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <button type="button" aria-label="Open menu" className={styles.iconBtn} onClick={props.onMenu}>
          <MenuIcon />
        </button>
        <div className={styles.titleBlock}>
          <span className={styles.title}>Attendance report</span>
          <span className={styles.subtitle}>{props.subtitle}</span>
        </div>
        {props.canPickBranch ? (
          <label className={styles.branchPill} data-testid="branch-pill">
            {branch?.name ?? "…"}
            <ChevronDownIcon className={styles.branchCaret} />
            <select aria-label="Branch" value={props.branchId ?? ""} onChange={(e) => props.onBranch(Number(e.target.value))}>
              {props.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" aria-label="Download report" className={styles.iconBtn} onClick={props.onDownload}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
        </button>
      </div>
      <div className={styles.periodRow}>
        <button type="button" aria-label="Previous" className={styles.navBtn} disabled={!props.canPrev} onClick={props.onPrev}>
          ‹
        </button>
        <div className={styles.periodText}>
          <span className={styles.periodTitle}>{props.title}</span>
          <span className={styles.periodSub}>{props.sub}</span>
        </div>
        <button type="button" aria-label="Next" className={styles.navBtn} disabled={!props.canNext} onClick={props.onNext}>
          ›
        </button>
      </div>
      <div role="tablist" aria-label="View" className={styles.tabs}>
        {MOBILE_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={props.view === v.key}
            className={styles.tab}
            onClick={() => props.onView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </header>
  );
}

// ------------------------------------------------------------ rows

function Pills({ row }: { row: ReportRow }) {
  const t = row.totals;
  return (
    <span className={styles.pills}>
      <span className={styles.pill} style={{ background: "#E6F5F3", color: "#0A5454" }}>
        P {t.present}
      </span>
      <span className={styles.pill} style={{ background: "#FFF4CC", color: "#7A5600" }}>
        O {t.overtime_hours}h
      </span>
      <span
        className={styles.pill}
        style={t.absent ? { background: "#FBE9E4", color: "#8E2F12" } : { background: "#F4F5F2", color: "#8A949A" }}
      >
        A {t.absent}
      </span>
    </span>
  );
}

export function MonthStrip({ row, days, today, hideSat }: { row: ReportRow; days: DayHeader[]; today: string; hideSat: boolean }) {
  return (
    <span aria-hidden="true" className={styles.strip}>
      {days.map((d, i) =>
        hideSat && d.is_weekly_off ? null : (
          <span key={d.bs_date} className={styles.block} data-look={cellLook(row.cells[i], d, today)} style={stripStyle(cellLook(row.cells[i], d, today))} />
        ),
      )}
    </span>
  );
}

export function MonthCalendar({ row, days, today }: { row: ReportRow; days: DayHeader[]; today: string }) {
  const lead = days[0]?.weekday ?? 0;
  const t = row.totals;
  return (
    <div className={styles.calWrap}>
      <div className={styles.calGrid}>
        {WEEKDAYS_SHORT_EN.map((w, i) => (
          <span key={w} className={styles.calHead} data-sat={i === 6 || undefined}>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className={styles.calBlank} />
        ))}
        {days.map((d, i) => {
          const look = cellLook(row.cells[i], d, today);
          return (
            <span key={d.bs_date} className={styles.calCell} data-look={look} style={paleStyle(look, d.bs_date === today)}>
              <b className={styles.calBs}>{d.bs_day}</b>
              <span className={styles.calAd}>{formatAdShort(d.ad_date, false)}</span>
              <span className={styles.calMark}>{calendarMark(look, row.cells[i]?.ot_hours ?? 0)}</span>
            </span>
          );
        })}
      </div>
      <div className={styles.calSummary}>
        Present {t.present} · Overtime {t.overtime_days} days ({t.overtime_hours} h) · Absent {t.absent}
      </div>
    </div>
  );
}

function Avatar({ employee, on }: { employee: ReportRow["employee"]; on?: boolean }) {
  return (
    <span className={styles.avatar} data-on={on || undefined}>
      <FaceContent employee={employee} />
    </span>
  );
}

function idLine(row: ReportRow): string {
  return row.employee.designation ? `${row.employee.code} · ${row.employee.designation}` : row.employee.code;
}

export function MonthCard(props: { row: ReportRow; days: DayHeader[]; today: string; hideSat: boolean; open: boolean; onToggle: () => void }) {
  const { row, open } = props;
  return (
    <>
      <button type="button" aria-expanded={open} className={styles.monthBtn} data-open={open || undefined} onClick={props.onToggle}>
        <span className={styles.personRow}>
          <Avatar employee={row.employee} on={open} />
          <span className={styles.person}>
            <span className={styles.name}>{row.employee.name}</span>
            <span className={styles.meta}>{idLine(row)}</span>
          </span>
          <Pills row={row} />
        </span>
        <MonthStrip row={row} days={props.days} today={props.today} hideSat={props.hideSat} />
      </button>
      {open ? <MonthCalendar row={row} days={props.days} today={props.today} /> : null}
    </>
  );
}

/** Seven Sun–Sat slots of the week; null where the slot is outside the month. */
export function weekSlots(days: DayHeader[], indices: number[]): (number | null)[] {
  const slots: (number | null)[] = Array(7).fill(null);
  for (const i of indices) slots[days[i].weekday] = i;
  return slots;
}

export function WeekRow({ row, days, indices, today }: { row: ReportRow; days: DayHeader[]; indices: number[]; today: string }) {
  const t = computeTotals(indices.map((i) => row.cells[i]));
  return (
    <div className={styles.weekRow}>
      <span className={styles.person}>
        <span className={styles.weekName}>{row.employee.name}</span>
        <span className={styles.weekSum}>
          P {t.present} · O {t.overtime_days} · A {t.absent}
        </span>
      </span>
      {weekSlots(days, indices).map((i, slot) => {
        if (i === null) return <span key={slot} className={styles.weekEmpty} />;
        const look = cellLook(row.cells[i], days[i], today);
        return (
          <span key={slot} className={styles.weekBox} data-look={look} style={paleStyle(look, days[i].bs_date === today)}>
            {weekMark(look, row.cells[i]?.ot_hours ?? 0)}
          </span>
        );
      })}
    </div>
  );
}

function viaText(record: AttendanceRecord): string {
  const { hour, minute } = kathmanduTime(record.updated_at);
  return `${clockText(hour, minute)} · ${record.marked_via === "scan" ? "scan" : "manual"}`;
}

export function dayMeta(row: ReportRow, look: CellLook, record: AttendanceRecord | undefined): string {
  const code = row.employee.code;
  if (look === "P" || look === "O") return record ? `${code} · marked ${viaText(record)}` : `${code} · marked`;
  if (look === "A") return record ? `${code} · marked absent · ${viaText(record)}` : `${code} · marked absent`;
  if (look === "N") return `${code} · not marked yet`;
  return idLine(row);
}

export function DayRow({ row, day, index, today, record }: { row: ReportRow; day: DayHeader; index: number; today: string; record?: AttendanceRecord }) {
  const look = cellLook(row.cells[index], day, today);
  const pale = PALE_COLOUR[look];
  return (
    <div className={styles.dayRow}>
      <Avatar employee={row.employee} />
      <span className={styles.person}>
        <span className={styles.name}>{row.employee.name}</span>
        <span className={styles.meta}>{dayMeta(row, look, record)}</span>
      </span>
      <span
        className={styles.dayPill}
        data-look={look}
        style={{ background: pale.bg, color: pale.fg, border: look === "N" ? "1px dashed #C0392B" : undefined }}
      >
        {dayPillText(look, row.cells[index]?.ot_hours ?? 0)}
      </span>
    </div>
  );
}

export const LEGEND: { look: CellLook; label: string }[] = [
  { look: "P", label: "Present" },
  { look: "O", label: "Overtime" },
  { look: "A", label: "Absent" },
  { look: "W", label: "Saturday" },
  { look: "N", label: "Not marked" },
];

// ------------------------------------------------------------ download sheet

export function DownloadSheet(props: {
  scope: string;
  hideSat: boolean;
  onHideSat: (on: boolean) => void;
  exporting: "pdf" | "xlsx" | null;
  onExport: (format: "pdf" | "xlsx") => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useDialog(props.onClose);
  return (
    <div className={styles.sheetWrap}>
      <div aria-hidden="true" className={styles.sheetBackdrop} onClick={props.onClose} />
      <section
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={dialog.onKeyDown}
      >
        <span aria-hidden="true" className={styles.handle} />
        <div className={styles.sheetHead}>
          <h2 id={titleId} className={styles.sheetTitle}>
            Download report
          </h2>
          <span className={styles.sheetScope}>{props.scope}</span>
        </div>
        <label className={styles.switchRow}>
          Hide Saturdays
          <button
            type="button"
            role="switch"
            aria-checked={props.hideSat}
            className={styles.switch}
            onClick={() => props.onHideSat(!props.hideSat)}
          >
            <span className={styles.knob} />
          </button>
        </label>
        <div className={styles.exportBtns}>
          <button type="button" className={styles.exportBtn} disabled={props.exporting !== null} onClick={() => props.onExport("pdf")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E2F12" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 3h9l4 4v14H6z" />
              <path d="M15 3v4h4" />
            </svg>
            {props.exporting === "pdf" ? "Preparing…" : "PDF"}
          </button>
          <button type="button" className={styles.exportBtn} disabled={props.exporting !== null} onClick={() => props.onExport("xlsx")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E7A3C" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M4 10h16M10 4v16" />
            </svg>
            {props.exporting === "xlsx" ? "Preparing…" : "Excel"}
          </button>
        </div>
        <button type="button" className={styles.cancelBtn} onClick={props.onClose}>
          Cancel
        </button>
      </section>
    </div>
  );
}
