"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { useSession } from "@/lib/session";
import { exportReport, getReport, getToday, listMonths } from "./api";
import { WEEKDAYS_EN, formatAdRange, formatAdShort, monthName as bsMonthName } from "@/lib/bs";
import { downloadFile, openPrintWindow, writePrintDocument } from "./download";
import { filterReportRows } from "./exportModel";
import { SearchIcon } from "./icons";
import { Pager } from "./Pager";
import { AdvanceGlyph, ReportGrid, SalaryGlyph, type GridGroup, type GridMode } from "./ReportGrid";
import {
  attendanceRate,
  computeTotals,
  formatRate,
  groupByDepartment,
  openDays,
  paginate,
  presenceSummary,
  sliceWeeks,
  sortRows,
  staffPresentPerDay,
  sumTotals,
  weekIndexOfDay,
} from "./helpers";
import type { CellStatus, DayHeader, MonthOption, MonthReport, ReportFilters, ReportRow, ReportSort, TodayRef } from "./types";
import shared from "./shared.module.css";
import styles from "./report.module.css";

const PER_PAGE = 25;
const COMPANY = "TTK"; // TODO backend: company name from core.settings

type View = GridMode;
type DayFilter = "" | "P" | "O" | "A";

const DAY_CHIPS: { key: DayFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "P", label: "Present" },
  { key: "O", label: "Overtime" },
  { key: "A", label: "Absent" },
];

/** Keep the chosen columns of every row; month totals stay whole unless `retotal`. */
function project(rows: readonly ReportRow[], indices: readonly number[], retotal: boolean): ReportRow[] {
  return rows.map((row) => {
    const cells = indices.map((i) => row.cells[i]);
    return { employee: row.employee, cells, totals: retotal ? computeTotals(cells) : row.totals };
  });
}

export function ReportPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [today, setToday] = useState<TodayRef | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [branchId, setBranchId] = useState<number | null>(null);
  const [view, setView] = useState<View>("month");
  const [weekIndex, setWeekIndex] = useState(1);
  const [dayIndex, setDayIndex] = useState(0);
  const [dayFilter, setDayFilter] = useState<DayFilter>("");
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ReportSort>("dept");
  const [group, setGroup] = useState(true);
  const [photos, setPhotos] = useState(false);
  const [payIcons, setPayIcons] = useState(true);
  const [hideOff, setHideOff] = useState(false);
  const [page, setPage] = useState(1);

  const [report, setReport] = useState<MonthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  // Months available + today → default month.
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
    getReport(monthKey, branchId)
      .then((body) => {
        if (cancelled) return;
        setReport(body);
        // Everyone reports on one branch; the first one until the user picks another.
        if (branchId === null && body.branches.length) setBranchId(body.branches[0].id);
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
  }, [monthKey, branchId]);

  const monthName = report ? bsMonthName(report.month.bs_month) : "";
  const allDays = useMemo(() => report?.month.days ?? [], [report]);
  const weeks = useMemo(() => sliceWeeks(allDays, monthName), [allDays, monthName]);
  const sameMonth = !!report && !!today && today.bs_date.slice(0, 7) === report.month.key;
  const todayIndex = sameMonth ? Math.min(allDays.length - 1, Number(today!.bs_date.slice(8)) - 1) : allDays.length - 1;

  // When the month loads, jump to the week / day containing today (same month) or the last day.
  useEffect(() => {
    if (!report) return;
    setWeekIndex(weekIndexOfDay(weeks, todayIndex + 1));
    setDayIndex(todayIndex);
  }, [report, weeks, todayIndex]);

  const week = weeks[Math.min(Math.max(1, weekIndex), Math.max(1, weeks.length)) - 1] ?? null;

  // Which columns of the month are in view, as indices into month.days.
  const indices = useMemo<number[]>(() => {
    if (!report) return [];
    if (view === "day") return allDays.length ? [Math.min(dayIndex, allDays.length - 1)] : [];
    let idx = allDays.map((_, i) => i);
    if (view === "week" && week) idx = idx.slice(week.offset, week.offset + week.days.length);
    if (hideOff) idx = idx.filter((i) => !allDays[i].is_weekly_off);
    return idx;
  }, [report, view, allDays, dayIndex, week, hideOff]);
  const days = useMemo<DayHeader[]>(() => indices.map((i) => allDays[i]), [indices, allDays]);

  const filters = useMemo<ReportFilters>(
    () => ({ month: monthKey, branch_id: branchId, department_id: departmentId, query, sort, group, hide_weekly_off: hideOff }),
    [monthKey, branchId, departmentId, query, sort, group, hideOff],
  );
  const order = useMemo(() => report?.departments.map((d) => d.id) ?? [], [report]);

  // Rows in the filter, for the days in view, sorted.
  const viewRows = useMemo(() => {
    if (!report) return [];
    let rows = project(filterReportRows(report, filters), indices, view !== "month");
    if (view === "day" && dayFilter) rows = rows.filter((r) => r.cells[0]?.status === dayFilter);
    return sortRows(rows, filters.sort, filters.group, order);
  }, [report, filters, indices, view, dayFilter, order]);

  // Day view chips count the whole filter before the status chip is applied.
  const dayCounts = useMemo(() => {
    const counts: Record<DayFilter, number> = { "": 0, P: 0, O: 0, A: 0 };
    if (!report || view !== "day") return counts;
    for (const r of filterReportRows(report, filters)) {
      const st = r.cells[indices[0]]?.status as CellStatus | undefined;
      counts[""] += 1;
      if (st === "P" || st === "O" || st === "A") counts[st] += 1;
    }
    return counts;
  }, [report, filters, indices, view]);

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

  const dayWord = (i: number) => {
    if (sameMonth && i === todayIndex) return "Today";
    if (sameMonth && i === todayIndex - 1) return "Yesterday";
    return allDays[i] ? WEEKDAYS_EN[allDays[i].weekday] : "Day";
  };
  const day = days[0];

  const subtitle = (() => {
    if (!report) return "Monthly attendance per employee, with overtime hours and paid days.";
    const m = report.month;
    if (view === "day" && day) {
      return `${dayWord(dayIndex)} · ${monthName} ${day.bs_day}, ${m.bs_year} · ${formatAdShort(day.ad_date, true)} · ${WEEKDAYS_EN[day.weekday]}`;
    }
    if (view === "week" && week) {
      const first = week.days[0];
      const last = week.days[week.days.length - 1];
      return `Week ${week.index} of ${m.label} · ${monthName} ${first.bs_day}–${last.bs_day} · ${formatAdRange(first.ad_date, last.ad_date)}`;
    }
    return `${m.label} · ${formatAdRange(m.ad_start, m.ad_end)} · ${m.working_days} working days${hideOff ? " · Saturdays hidden" : ""}`;
  })();

  const resetPage = () => setPage(1);
  const monthIndex = months.findIndex((m) => m.key === monthKey);
  const monthOption = months[monthIndex];
  const shiftMonthBy = (delta: number) => {
    const next = months[monthIndex + delta];
    if (!next) return;
    setMonthKey(next.key);
    resetPage();
  };
  const nextMonthOff = monthIndex < 0 || monthIndex >= months.length - 1;
  const nextDayOff = dayIndex >= todayIndex;

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
  const branch = report?.branches.find((b) => b.id === branchId) ?? report?.branches[0];

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
                setDayFilter("");
                resetPage();
              }}
              options={[
                { value: "month", label: "Month" },
                { value: "day", label: "Today" },
                { value: "week", label: "Week" },
              ]}
            />
            {view === "day" ? (
              <div className={styles.weekNav}>
                <button
                  type="button"
                  className={shared.pagerBtn}
                  aria-label="Previous day"
                  onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
                  disabled={dayIndex <= 0}
                >
                  ‹
                </button>
                <span className={styles.weekLabel} aria-live="polite">
                  {day ? `${dayWord(dayIndex)} · ${monthName} ${day.bs_day}` : "…"}
                </span>
                <button
                  type="button"
                  className={shared.pagerBtn}
                  aria-label="Next day"
                  onClick={() => setDayIndex((i) => Math.min(todayIndex, i + 1))}
                  disabled={nextDayOff}
                >
                  ›
                </button>
              </div>
            ) : null}
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
            <div role="group" aria-label="Month (BS)" className={styles.monthNav}>
              <button
                type="button"
                className={styles.monthNavBtn}
                aria-label="Previous month"
                onClick={() => shiftMonthBy(-1)}
                disabled={monthIndex <= 0}
              >
                ‹
              </button>
              <span className={styles.monthLabel}>
                <span lang="ne" className={styles.monthNp}>
                  {monthOption?.label_np ?? report?.month.label_np ?? "…"}
                </span>
                <span className={styles.monthEn}>{monthOption?.label ?? report?.month.label ?? monthKey}</span>
              </span>
              <button
                type="button"
                className={styles.monthNavBtn}
                aria-label="Next month"
                onClick={() => shiftMonthBy(1)}
                disabled={nextMonthOff}
              >
                ›
              </button>
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

      <div className={styles.branchRow}>
        <span className={styles.branchLabel}>Branch</span>
        {isAdmin ? (
          <div className={`${shared.field} ${styles.branchField}`}>
            <select
              aria-label="Branch"
              value={branchId ?? ""}
              onChange={(e) => {
                setBranchId(Number(e.target.value));
                setDepartmentId(null);
                resetPage();
              }}
            >
              {(report?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className={styles.branchPill} title="Ask an admin for 'See other branches' access">
            {branch?.name ?? "…"} <span className={styles.branchPillSub}>· your branch</span>
          </span>
        )}
      </div>

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
              <option value="overtime">Most overtime</option>
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
        <label className={shared.check}>
          <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />
          Show employee photos
        </label>
        <label className={shared.check}>
          <input type="checkbox" checked={payIcons} onChange={(e) => setPayIcons(e.target.checked)} />
          Show payment icons
        </label>
        <label className={shared.check}>
          <input type="checkbox" checked={hideOff} onChange={(e) => setHideOff(e.target.checked)} />
          Hide holidays (Saturdays)
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
          <span className={styles.sumLabel}>Total present days</span>
          <span className={styles.sumValue}>{presence.present_days}</span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Overtime</span>
          <span className={`${styles.sumValue} ${styles.sumOt}`}>{totals.overtime_hours} h</span>
        </div>
        <div className={`card ${styles.sumCard}`}>
          <span className={styles.sumLabel}>Absences</span>
          <span className={styles.sumValue}>{totals.absent}</span>
        </div>
      </section>

      <div className={styles.legend} aria-label="Legend">
        <span className={styles.key}>
          <span className={styles.cell} data-status="P" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          Present
        </span>
        <span className={styles.key}>
          <span className={styles.cell} data-status="O" aria-hidden="true">
            2h
          </span>
          Overtime (hours)
        </span>
        <span className={styles.key}>
          <span className={styles.cell} data-status="A" aria-hidden="true">
            A
          </span>
          Absent
        </span>
        {!hideOff ? (
          <span className={styles.key}>
            <span className={styles.cell} data-status="W" aria-hidden="true">
              –
            </span>
            Weekly off (Sat)
          </span>
        ) : null}
        {payIcons ? (
          <>
            <span className={styles.key}>
              <span className={`${styles.payBadge} ${styles.payBadgeAdv} ${styles.payBadgeKey}`} aria-hidden="true">
                <AdvanceGlyph />
              </span>
              Advance taken
            </span>
            <span className={styles.key}>
              <span className={`${styles.payBadge} ${styles.payBadgeSal} ${styles.payBadgeKey}`} aria-hidden="true">
                <SalaryGlyph />
              </span>
              Salary taken
            </span>
          </>
        ) : null}
      </div>

      {view === "day" ? (
        <section role="group" aria-label="Show" className={styles.dayChips}>
          <span className={styles.dayChipsLabel}>Show</span>
          {DAY_CHIPS.map((c) => (
            <button
              key={c.key || "all"}
              type="button"
              className={styles.dayChip}
              data-filter={c.key || "all"}
              aria-pressed={dayFilter === c.key}
              onClick={() => {
                setDayFilter(c.key);
                resetPage();
              }}
            >
              <span>{c.label}</span>
              <b>{dayCounts[c.key]}</b>
            </button>
          ))}
        </section>
      ) : null}

      {error ? (
        <div className={styles.messages}>
          <p role="alert" className={shared.error}>
            {error}
          </p>
        </div>
      ) : null}

      {loading && !report ? (
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
            mode={view}
            photos={photos}
            payIcons={payIcons}
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
            Paid days = P + O + W (Saturdays). Absent is unpaid. Overtime hours are paid on top at the rate set
            per employee.
          </p>
        </>
      ) : null}
    </>
  );
}
