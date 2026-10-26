"use client";

import { BranchSwitcher } from "@/components/BranchSwitcher";
import { useActiveBranch } from "@/lib/branchContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WEEKDAYS_SHORT_EN } from "@/lib/bs";
import { useSession } from "@/lib/session";
import { useShell } from "@/lib/shell";
import { exportReport, getDay, getReport } from "./api";
import { listMonths, todayRef } from "./calendar";
import { downloadFile, openPrintWindow, writePrintDocument } from "./download";
import { DayRow, DownloadSheet, LEGEND, MobileHeader, MonthCard, WeekRow, departmentChips, mobileGroups, stripStyle, weekSlots } from "./ReportMobileParts";
import { SearchIcon } from "./icons";
import { periodFromParams, periodIndices, periodParams, periodTitle, stepPeriod, type Period, type PeriodBounds } from "./reportPeriod";
import type { AttendanceRecord, MonthReport, ReportFilters } from "./types";
import styles from "./reportMobile.module.css";

const COMPANY = "TTK"; // as ReportPage. TODO backend: company name from core.settings

// ------------------------------------------------------------ screen

/**
 * Phone layout (< 640px) of the Attendance report: dark header with menu, the shell's
 * active-branch switcher (the report is always the ONE active branch), download sheet, ‹ period › and Month | Week | Day; search, department chips
 * and staff cards grouped by department. Same report endpoint and exports as the desktop
 * ReportPage; the Day view also reads /day for when and how each mark was made. Period and view
 * live in the URL (?view=&bs_year=&bs_month=&week=&day=). No payment information here.
 */
export function ReportMobile() {
  const { user } = useSession();
  // The ONE active branch (lib/branch.tsx); switching it remounts the page (AppShell).
  const { branch } = useActiveBranch();
  const { openMenu } = useShell();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const employeeParam = Number(params.get("employee")) || null;

  // Today in Kathmandu and the months the report offers (the same ones as the desktop select).
  const bounds = useMemo<PeriodBounds>(() => ({ months: listMonths().map((m) => m.key), today: todayRef().bs_date }), []);
  const period = useMemo(() => periodFromParams(new URLSearchParams(params.toString()), bounds), [params, bounds]);

  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(employeeParam);
  const [sheet, setSheet] = useState(false);
  const [hideSat, setHideSat] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [report, setReport] = useState<MonthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayRecords, setDayRecords] = useState<Map<number, AttendanceRecord>>(new Map());

  // The page scrolls inside its own panel; keep the shell behind it still.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getReport(period.month)
      .then((body) => {
        if (cancelled) return;
        setReport(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof Error ? err.message : "Could not load the report.");
      });
    return () => {
      cancelled = true;
    };
    // The active branch is part of the key: a switch fetches again.
  }, [period.month, branch?.id]);

  const dayBs = report && period.view === "day" ? report.month.days[period.day - 1]?.bs_date : undefined;
  useEffect(() => {
    if (!dayBs) {
      setDayRecords(new Map());
      return;
    }
    let cancelled = false;
    getDay(dayBs)
      .then((body) => {
        if (cancelled) return;
        setDayRecords(new Map(body.rows.flatMap((r) => (r.record ? [[r.employee.id, r.record] as const] : []))));
      })
      .catch(() => {
        if (!cancelled) setDayRecords(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [dayBs, branch?.id]);

  const go = useCallback(
    (next: Period) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(periodParams(next))) search.set(key, value);
      router.replace(`${pathname}?${search.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const prev = stepPeriod(period, -1, bounds);
  const next = stepPeriod(period, 1, bounds);
  const head = periodTitle(period, bounds.today);
  // The report of the month in the URL (the previous one stays on screen while the next loads).
  const shown = report && report.month.key === period.month ? report : null;
  const days = shown?.month.days ?? [];
  const indices = periodIndices(period).filter((i) => i < days.length);
  const groups = shown ? mobileGroups(shown, departmentId, query, employeeParam) : [];
  const chips = shown ? departmentChips(shown) : [];
  const department = report?.departments.find((d) => d.id === departmentId);
  const subtitle = `${branch?.name ?? "…"} · ${department ? department.name : "all departments"}`;
  const scope = `${head.title.replace(" · आज", "")} · ${branch?.name ?? "…"}${department ? ` · ${department.name}` : ""}`;

  const runExport = async (format: "pdf" | "xlsx") => {
    const printWindow = format === "pdf" ? openPrintWindow() : null;
    setExporting(format);
    setError(null);
    try {
      const filters: ReportFilters = {
        month: period.month,
        branch_id: branch?.id ?? null,
        department_id: departmentId,
        query,
        sort: "dept",
        group: true,
        hide_weekly_off: hideSat,
        employee_id: employeeParam,
      };
      const file = await exportReport(format, filters, { company: COMPANY, printedBy: user?.full_name ?? "", today: todayRef() });
      if (format === "pdf") {
        if (printWindow) await writePrintDocument(printWindow, file);
        else downloadFile({ ...file, filename: file.filename.replace(/\.pdf$/, ".html") });
      } else {
        downloadFile(file);
      }
      setSheet(false);
    } catch (err) {
      printWindow?.close();
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const clearEmployee = () => {
    const search = new URLSearchParams(params.toString());
    search.delete("employee");
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };
  const onlyName = employeeParam !== null ? shown?.rows.find((r) => r.employee.id === employeeParam)?.employee.name : undefined;

  return (
    <div className={styles.screen} data-testid="report-mobile">
      <MobileHeader
        subtitle={subtitle}
        branchSwitcher={<BranchSwitcher variant="bar" />}
        onMenu={openMenu}
        onDownload={() => setSheet(true)}
        title={head.title}
        sub={head.sub}
        canPrev={prev !== null}
        canNext={next !== null}
        onPrev={() => prev && go(prev)}
        onNext={() => next && go(next)}
        view={period.view}
        onView={(view) => go({ ...period, view })}
      />

      <div className={styles.body}>
        <div className={styles.searchWrap}>
          <div className={styles.field}>
            <SearchIcon />
            <input type="search" aria-label="Search staff" placeholder="Search name or ID" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className={styles.chips} role="group" aria-label="Department">
          {chips.map((c) => (
            <button key={c.id ?? "all"} type="button" className={styles.chip} aria-pressed={c.id === departmentId} onClick={() => setDepartmentId(c.id)}>
              {c.name} <b className={styles.chipCount}>{c.count}</b>
            </button>
          ))}
        </div>
        {employeeParam !== null ? (
          <div className={styles.onlyRow}>
            <span className={styles.onlyChip} data-testid="only-employee">
              Showing {onlyName ?? "one employee"} ·
              <button type="button" className={styles.onlyClear} onClick={clearEmployee}>
                Clear
              </button>
            </span>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}

        {!shown && !error ? <p className={styles.note}>Loading…</p> : null}

        {shown && period.view === "week" && groups.length ? (
          <div className={styles.weekHead}>
            <span className={styles.weekHeadStaff}>Staff</span>
            {weekSlots(days, indices).map((i, slot) => (
              <span
                key={slot}
                className={styles.weekHeadDay}
                data-sat={slot === 6 || undefined}
                data-today={(i !== null && days[i].bs_date === bounds.today) || undefined}
              >
                <b>{WEEKDAYS_SHORT_EN[slot][0]}</b>
                <span className={styles.weekHeadDate}>{i !== null ? days[i].bs_day : ""}</span>
              </span>
            ))}
          </div>
        ) : null}

        {shown
          ? groups.map((g) => (
              <section key={g.department_id} className={styles.group} aria-label={g.department_name || "No department"}>
                <div className={styles.groupHead}>
                  <span className={styles.groupName}>{g.department_name || "No department"}</span>
                  <span className={styles.groupCount}>· {g.rows.length} staff</span>
                </div>
                <div className={styles.card}>
                  {g.rows.map((row) => (
                    <div key={row.employee.id} className={styles.cardRow}>
                      {period.view === "month" ? (
                        <MonthCard
                          row={row}
                          days={days}
                          today={bounds.today}
                          hideSat={hideSat}
                          open={openId === row.employee.id}
                          onToggle={() => setOpenId(openId === row.employee.id ? null : row.employee.id)}
                        />
                      ) : period.view === "week" ? (
                        <WeekRow row={row} days={days} indices={indices} today={bounds.today} />
                      ) : days[indices[0]] ? (
                        <DayRow row={row} day={days[indices[0]]} index={indices[0]} today={bounds.today} record={dayRecords.get(row.employee.id)} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))
          : null}

        {shown && groups.length === 0 ? <p className={styles.empty}>No staff match. Try another department or clear the search.</p> : null}

        <div className={styles.legend} aria-label="Legend">
          {LEGEND.map((l) => (
            <span key={l.look} className={styles.legendItem}>
              <span className={styles.legendDot} style={stripStyle(l.look)} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {sheet ? (
        <DownloadSheet
          scope={scope}
          hideSat={hideSat}
          onHideSat={setHideSat}
          exporting={exporting}
          onExport={(f) => void runExport(f)}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </div>
  );
}
