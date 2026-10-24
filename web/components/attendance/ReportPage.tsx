"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { useSession } from "@/lib/session";
import { exportReport, getReport, getToday, listMonths } from "./api";
import { formatAdRange, monthName as bsMonthName, weekdayKeyText } from "./bsdate";
import { downloadFile, openPrintWindow, writePrintDocument } from "./download";
import { filterReportRows } from "./exportModel";
import { SearchIcon } from "./icons";
import { Pager } from "./Pager";
import { ReportGrid, type GridGroup } from "./ReportGrid";
import {
  attendanceRate,
  formatRate,
  groupByDepartment,
  openDays,
  paginate,
  presenceSummary,
  sliceRows,
  sliceWeeks,
  sortRows,
  staffPresentPerDay,
  sumTotals,
  weekIndexOfDay,
} from "./helpers";
import type { CellStatus, MonthOption, MonthReport, ReportFilters, ReportSort, TodayRef } from "./types";
import shared from "./shared.module.css";
import styles from "./report.module.css";

const PER_PAGE = 25;
const COMPANY = "TTK"; // TODO backend: company name from core.settings

type View = "month" | "week";

const LEGEND: { status: CellStatus; code: string; label: string }[] = [
  { status: "P", code: "P", label: "Present" },
  { status: "O", code: "O", label: "Overtime (hours)" },
  { status: "A", code: "A", label: "Absent" },
  { status: "W", code: "–", label: "Weekly off (Sat)" },
];

export function ReportPage() {
  const { user } = useSession();
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [today, setToday] = useState<TodayRef | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [view, setView] = useState<View>("month");
  const [weekIndex, setWeekIndex] = useState(1);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ReportSort>("dept");
  const [group, setGroup] = useState(true);
  const [page, setPage] = useState(1);

  const [report, setReport] = useState<MonthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  // Months available + today → default month and week.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listMonths(), getToday()]).then(([options, now]) => {
      if (cancelled) return;
      setMonths(options);
      setToday(now);
      setMonthKey((current) => current || now.bs_date.slice(0, 7));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!monthKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReport(monthKey)
      .then((body) => {
        if (cancelled) return;
        setReport(body);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the report.");
        setReport(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  const monthName = report ? bsMonthName(report.month.bs_month) : "";
  const weeks = useMemo(
    () => (report ? sliceWeeks(report.month.days, monthName) : []),
    [report, monthName],
  );

  // When the month loads, jump to the week containing today (same month) or week 1.
  useEffect(() => {
    if (!report || !today) return;
    const sameMonth = today.bs_date.slice(0, 7) === report.month.key;
    const day = sameMonth ? Number(today.bs_date.slice(8)) : 1;
    setWeekIndex(weekIndexOfDay(weeks, day));
  }, [report, today, weeks]);

  const week = weeks[Math.min(Math.max(1, weekIndex), Math.max(1, weeks.length)) - 1] ?? null;
  const days = useMemo(
    () => (view === "week" && week ? week.days : (report?.month.days ?? [])),
    [view, week, report],
  );

  const filters = useMemo<ReportFilters>(
    () => ({ month: monthKey, department_id: departmentId, query, sort, group }),
    [monthKey, departmentId, query, sort, group],
  );
  const order = useMemo(() => report?.departments.map((d) => d.id) ?? [], [report]);

  // Rows in the filter, for the days in view, sorted.
  const viewRows = useMemo(() => {
    if (!report) return [];
    let rows = filterReportRows(report, filters);
    if (view === "week" && week) rows = sliceRows(rows, week);
    return sortRows(rows, filters.sort, filters.group, order);
  }, [report, filters, view, week, order]);

  const allRowsByDept = useMemo(() => {
    const map = new Map<number, { count: number; rate: number | null }>();
    if (!report) return map;
    for (const d of report.departments) {
      const rows = report.rows.filter((r) => r.employee.department_id === d.id);
      map.set(d.id, { count: rows.length, rate: attendanceRate(rows) });
    }
    return map;
  }, [report]);

  const presence = useMemo(() => presenceSummary(viewRows, days), [viewRows, days]);
  const totals = useMemo(() => sumTotals(viewRows), [viewRows]);
  const staffPresent = useMemo(() => staffPresentPerDay(viewRows, days), [viewRows, days]);
  const open = useMemo(() => openDays(viewRows, days), [viewRows, days]);
  const paged = useMemo(() => paginate(viewRows, page, PER_PAGE), [viewRows, page]);

  // Department headers show whole-filter headcount and rate even on a partial page.
  const gridGroups: GridGroup[] | null = useMemo(() => {
    if (!group) return null;
    const whole = groupByDepartment(viewRows);
    return groupByDepartment(paged.items).map((g) => {
      const w = whole.find((x) => x.department_id === g.department_id);
      return { ...g, rate: w?.rate ?? g.rate, count: w?.rows.length ?? g.rows.length };
    });
  }, [group, viewRows, paged.items]);

  const subtitle = (() => {
    if (!report) return "Monthly attendance per employee, with overtime hours and paid days.";
    const m = report.month;
    if (view === "week" && week) {
      const first = week.days[0];
      const last = week.days[week.days.length - 1];
      return `Week ${week.index} of ${m.label} · ${monthName} ${first.bs_day}–${last.bs_day} · ${formatAdRange(first.ad_date, last.ad_date)}`;
    }
    return `${m.label} · ${formatAdRange(m.ad_start, m.ad_end)} · ${m.working_days} working days`;
  })();

  const resetPage = () => setPage(1);

  const runExport = async (format: "xlsx" | "pdf") => {
    if (!report) return;
    const printWindow = format === "pdf" ? openPrintWindow() : null;
    setExporting(format);
    setError(null);
    try {
      const file = await exportReport(format, filters, {
        company: COMPANY,
        printedBy: user?.full_name ?? "",
        today,
      });
      if (format === "pdf") {
        if (printWindow) await writePrintDocument(printWindow, file);
        else downloadFile({ ...file, filename: file.filename.replace(/\.pdf$/, ".html") });
      } else {
        downloadFile(file);
      }
    } catch (err) {
      printWindow?.close();
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const chips = report
    ? [
        {
          key: "all",
          id: null as number | null,
          name: "All departments",
          count: report.rows.length,
          rate: attendanceRate(report.rows),
        },
        ...report.departments.map((d) => ({
          key: String(d.id),
          id: d.id as number | null,
          name: d.name,
          count: allRowsByDept.get(d.id)?.count ?? d.headcount,
          rate: allRowsByDept.get(d.id)?.rate ?? null,
        })),
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Attendance report"
        subtitle={subtitle}
        actions={
          <div className={styles.headerActions}>
            <Segmented<View>
              label="Period"
              value={view}
              onChange={(v) => {
                setView(v);
                resetPage();
              }}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
              ]}
            />
            {view === "week" ? (
              <div className={styles.weekNav}>
                <button
                  type="button"
                  className={shared.pagerBtn}
                  aria-label="Previous week"
                  onClick={() => setWeekIndex((i) => Math.max(1, i - 1))}
                  disabled={!week || week.index <= 1}
                >
                  ‹
                </button>
                <span className={styles.weekLabel} aria-live="polite">
                  {week?.label ?? "…"}
                </span>
                <button
                  type="button"
                  className={shared.pagerBtn}
                  aria-label="Next week"
                  onClick={() => setWeekIndex((i) => Math.min(weeks.length, i + 1))}
                  disabled={!week || week.index >= weeks.length}
                >
                  ›
                </button>
              </div>
            ) : null}
            <div className={`${shared.field} ${styles.monthField}`}>
              <select
                aria-label="Month (BS)"
                value={monthKey}
                onChange={(e) => {
                  setMonthKey(e.target.value);
                  resetPage();
                }}
              >
                {months.length === 0 && monthKey ? <option value={monthKey}>{monthKey}</option> : null}
                {months.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void runExport("xlsx")}
              disabled={!report || exporting !== null}
            >
              {exporting === "xlsx" ? "Preparing…" : "Excel"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void runExport("pdf")}
              disabled={!report || exporting !== null}
            >
              {exporting === "pdf" ? "Preparing…" : "PDF"}
            </button>
          </div>
        }
      />

      <section aria-label="Departments" className={styles.chips}>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={styles.chip}
            aria-pressed={chip.id === departmentId}
            onClick={() => {
              setDepartmentId(chip.id);
              resetPage();
            }}
          >
            <span className={styles.chipName}>{chip.name}</span>
            <span>{chip.count}</span>
            <span className={styles.chipRate}>{formatRate(chip.rate)}</span>
          </button>
        ))}
      </section>

      <section aria-label="Filters" className={styles.filters}>
        <div className={`${shared.field} ${styles.search}`}>
          <SearchIcon />
          <input
            type="search"
            aria-label="Search employee name or ID"
            placeholder="Search name or ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPage();
            }}
          />
        </div>
        <label className={styles.sortLabel}>
          <span>Sort by</span>
          <span className={`${shared.field} ${styles.sortField}`}>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as ReportSort);
                resetPage();
              }}
            >
              <option value="dept">Department, then name</option>
              <option value="name">Name</option>
              <option value="absent">Most absences</option>
              <option value="overtime">Most overtime hours</option>
            </select>
          </span>
        </label>
        <label className={shared.check}>
          <input
            type="checkbox"
            checked={group}
            onChange={(e) => {
              setGroup(e.target.checked);
              resetPage();
            }}
          />
          Group by department
        </label>
      </section>

      <section aria-label="Staff summary" className={styles.summary}>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Staff in view</span>
          <span className={styles.sumValue}>{viewRows.length}</span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Present per working day</span>
          <span className={styles.sumValue}>
            {presence.avg_present.toFixed(1)}{" "}
            <span className={styles.sumSub}>avg · {formatRate(presence.rate)}</span>
          </span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Present days</span>
          <span className={styles.sumValue}>{presence.present_days}</span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Overtime hours</span>
          <span className={styles.sumValue}>
            {totals.overtime_hours}{" "}
            <span className={styles.sumSub}>· {totals.overtime_days} days</span>
          </span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Absent days</span>
          <span className={styles.sumValue}>{totals.absent}</span>
        </div>
      </section>

      <div className={styles.legend} aria-label="Legend">
        {LEGEND.map((item) => (
          <span key={item.status} className={styles.key}>
            <span className={styles.cell} data-status={item.status} aria-hidden="true">
              {item.code}
            </span>
            {item.label}
          </span>
        ))}
        <span className={`${styles.key} ${styles.keyNp}`} lang="ne">
          {weekdayKeyText()}
        </span>
      </div>

      {error ? (
        <div className={styles.messages}>
          <p role="alert" className={shared.error}>
            {error}
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : report ? (
        <>
          <ReportGrid
            monthName={monthName}
            days={days}
            rows={paged.items}
            groups={gridGroups}
            staffPresent={staffPresent}
            openDays={open}
            staffCount={viewRows.length}
            avgPresent={presence.avg_present}
            wide={view === "week"}
          />
          <Pager
            page={paged.page}
            pages={paged.pages}
            onPage={setPage}
            numbered
            label={
              paged.total
                ? `Showing ${(paged.page - 1) * PER_PAGE + 1}–${Math.min(paged.page * PER_PAGE, paged.total)} of ${paged.total} employees · Excel and PDF export everyone in the filter`
                : "No employees in this filter"
            }
          />
          <p className={styles.rule}>
            Paid days = present + overtime days + weekly off. Absent is unpaid. Overtime hours are paid
            at the rate set per employee.
          </p>
        </>
      ) : null}
    </>
  );
}
