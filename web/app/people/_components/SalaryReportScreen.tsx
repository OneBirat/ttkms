"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { Icon } from "@/components/icons";
import { currentMonth, getSalaryReport, listBranches, listDepartments, listMonths } from "../api";
import { BranchSwitcher } from "./BranchSwitcher";
import { useReportBranch } from "../_lib/useBranchScope";
import { monthKey, monthLabel, monthName, parseMonthKey, sameMonth } from "../_lib/months";
import { downloadText, payrollSheetCsv } from "../_lib/exports";
import {
  STATUS_LABEL,
  formatAmount,
  formatDeduction,
  formatLakh,
  formatPaidDays,
  formatRs,
  matchesEmployee,
  paginate,
  percentChange,
  sortRows,
  statusPill,
} from "../_lib/helpers";
import type { ReportSort, SalaryReport } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./report.module.css";
import shared from "./payroll.module.css";

const PAGE_SIZE = 25;
const SORTS: { value: ReportSort; label: string }[] = [
  { value: "dept", label: "Department, then name" },
  { value: "name", label: "Name" },
  { value: "net", label: "Highest net" },
  { value: "due", label: "Most due" },
  { value: "paid_days", label: "Fewest paid days" },
];

function isSort(value: string | null): value is ReportSort {
  return SORTS.some((s) => s.value === value);
}

export function SalaryReportScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const monthSelectId = useId();
  const searchId = useId();
  const sortId = useId();
  const branchSelectId = useId();
  const branches = usePayroll(listBranches, []);
  const branchScope = useReportBranch(branches.data ?? []);

  const month = parseMonthKey(params.get("month") ?? "") ?? currentMonth();
  const deptParam = params.get("dept");
  const department = deptParam && /^\d+$/.test(deptParam) ? Number(deptParam) : null;
  const sort: ReportSort = isSort(params.get("sort")) ? (params.get("sort") as ReportSort) : "dept";
  const query = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in changes)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const hrefFor = (n: number) => {
    const next = new URLSearchParams(params.toString());
    if (n <= 1) next.delete("page");
    else next.set("page", String(n));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const months = usePayroll(listMonths, []);
  const departments = usePayroll(listDepartments, []);
  const report = usePayroll(() => getSalaryReport(month, department, branchScope.branchId), [monthKey(month), department, branchScope.branchId]);

  const data = report.data;
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter((row) => matchesEmployee(row.employee, query));
    return sortRows(rows, sort, departments.data ?? []);
  }, [data, query, sort, departments.data]);
  const paged = paginate(filteredRows, page, PAGE_SIZE);
  const deptName = department !== null ? (departments.data ?? []).find((d) => d.id === department)?.name : null;
  const scope = `${branchScope.label} · ${deptName ?? "all departments"}`;
  const running = sameMonth(month, currentMonth());
  const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  const fileStem = `salary-${monthKey(month)}-${slug(branchScope.label)}${deptName ? `-${slug(deptName)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Salary report"
        subtitle={`${monthLabel(month)}${running ? " (in progress)" : ""} · attendance from the attendance module · ${scope}`}
        actions={
          <div className={`${shared.row} ${styles.noPrint}`}>
            <BranchSwitcher scope={branchScope} id={branchSelectId} />
            <label htmlFor={monthSelectId} className={shared.srOnly}>
              Month (BS)
            </label>
            <div className={`field ${shared.selectWrap} ${styles.monthField}`}>
              <select id={monthSelectId} value={monthKey(month)} onChange={(event) => setParams({ month: event.target.value })}>
                {(months.data ?? [month]).map((m) => (
                  <option key={monthKey(m)} value={monthKey(m)}>
                    {monthLabel(m)}
                    {sameMonth(m, currentMonth()) ? " · in progress" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn" disabled={!data} onClick={() => downloadText(`${fileStem}.csv`, payrollSheetCsv(filteredRows))}>
              <Icon name="download" size={16} />
              Excel
            </button>
            <button type="button" className="btn" disabled={!data} onClick={() => window.print()}>
              <Icon name="print" size={16} />
              PDF
            </button>
          </div>
        }
      />

      <section aria-label="Departments" className={`${styles.chips} ${styles.noPrint}`}>
        <button type="button" className={shared.chip} aria-pressed={department === null} onClick={() => setParams({ dept: null })}>
          <span className={shared.chipName}>All departments</span>
          <span>{data?.all_staff ?? ""}</span>
        </button>
        {(data?.by_department ?? []).map((d) => (
          <button
            key={d.department.id}
            type="button"
            className={shared.chip}
            aria-pressed={department === d.department.id}
            onClick={() => setParams({ dept: String(d.department.id) })}
          >
            <span className={shared.chipName}>{d.department.name}</span>
            <span>{d.staff}</span>
          </button>
        ))}
      </section>

      {report.error ? (
        <EmptyState icon="alert" title="Could not load the report" text={payrollErrorMessage(report.error)}>
          <button type="button" className="btn" onClick={report.reload}>
            Try again
          </button>
        </EmptyState>
      ) : !data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <Totals data={data} />
          <div className={styles.charts}>
            <TrendChart data={data} />
            <DepartmentChart data={data} selected={department} />
          </div>

          <section aria-labelledby="pay-h" className={`card ${styles.sheet}`}>
            <div className={styles.sheetHead}>
              <h2 id="pay-h" className={shared.cardTitle}>
                Payroll sheet
              </h2>
              <div className={`${styles.sheetControls} ${styles.noPrint}`}>
                <label htmlFor={searchId} className={shared.srOnly}>
                  Search employee
                </label>
                <div className="field" style={{ width: 210 }}>
                  <Icon name="search" size={16} style={{ color: "var(--color-muted)" }} />
                  <input
                    id={searchId}
                    type="search"
                    placeholder="Search name or ID"
                    value={query}
                    onChange={(event) => setParams({ q: event.target.value })}
                    autoComplete="off"
                  />
                </div>
                <label htmlFor={sortId} className={styles.sortLabel}>
                  <span style={{ fontWeight: 600 }}>Sort</span>
                  <span className={`field ${shared.selectWrap}`} style={{ width: 200 }}>
                    <select id={sortId} value={sort} onChange={(event) => setParams({ sort: event.target.value })}>
                      {SORTS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
            </div>

            <div className={shared.tableWrap}>
              <table className={shared.table}>
                <caption className={shared.srOnly}>
                  Payroll sheet for {monthLabel(month)}, {scope}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Dept</th>
                    <th scope="col" className={shared.num}>
                      Paid days
                    </th>
                    <th scope="col" className={shared.num}>
                      Gross
                    </th>
                    <th scope="col" className={shared.num}>
                      Absence
                    </th>
                    <th scope="col" className={shared.num}>
                      Advance paid
                    </th>
                    <th scope="col" className={shared.num}>
                      TDS
                    </th>
                    <th scope="col" className={shared.num}>
                      Net
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={shared.empty}>
                        No employee matches.
                      </td>
                    </tr>
                  ) : (
                    paged.items.map(({ employee, ledger }) => (
                      <tr key={employee.id}>
                        <td>
                          <Link href={`/people/employees/${employee.id}`} className={styles.empCell}>
                            <span className={styles.empName}>{employee.full_name}</span>
                            <span className={styles.empSub}>
                              {employee.code} · {employee.designation ?? "—"} · {ledger.pay_type === "monthly" ? "Monthly" : `Daily ${formatAmount(ledger.rate)}/day`}
                            </span>
                          </Link>
                        </td>
                        <td>{employee.department?.name ?? "—"}</td>
                        <td className={shared.num}>{formatPaidDays(ledger.paid_days, ledger.attendance.days_in_month)}</td>
                        <td className={shared.num} title={ledger.overtime_pay ? `incl. overtime ${formatRs(ledger.overtime_pay)}` : undefined}>
                          {formatAmount(ledger.earnings)}
                        </td>
                        <td className={shared.num}>{formatDeduction(ledger.absence_deduction)}</td>
                        <td className={shared.num}>{formatDeduction(ledger.advance_paid)}</td>
                        <td className={shared.num}>{formatDeduction(ledger.tds)}</td>
                        <td className={`${shared.num} ${shared.kvStrong}`}>{formatAmount(ledger.net)}</td>
                        <td>
                          {ledger.status === "pending" ? (
                            <span className={shared.pillNeutral}>Pending</span>
                          ) : (
                            <Pill status={statusPill(ledger.status)} label={STATUS_LABEL[ledger.status]} />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} style={{ textAlign: "left" }}>
                      Total · {filteredRows.length} staff
                    </th>
                    <td className={shared.num}>{formatAmount(sum(filteredRows, "earnings"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "absence_deduction"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "advance_paid"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "tds"))}</td>
                    <td className={`${shared.num} ${shared.ok}`}>{formatAmount(sum(filteredRows, "net"))}</td>
                    <td className={shared.note}>{formatRs(sum(filteredRows, "due"))} due</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {paged.pages > 1 ? (
              <div className={`${styles.pager} ${styles.noPrint}`}>
                <Pagination
                  page={paged.page}
                  pages={paged.pages}
                  hrefFor={hrefFor}
                  summary={`Showing ${(paged.page - 1) * PAGE_SIZE + 1}–${Math.min(paged.page * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}
                />
              </div>
            ) : null}
            <span className={styles.sheetNote}>
              Gross includes overtime. Monthly staff: absence = salary ÷ days in month × absent days; Saturdays are paid.
              Daily wage: wage × days present. Advances already paid are part of the net; the status compares net
              with every payment of the month. Exports include everyone in the current filter.
            </span>
          </section>
        </>
      )}
    </>
  );
}

function sum(rows: SalaryReport["rows"], key: "earnings" | "absence_deduction" | "advance_paid" | "tds" | "net" | "due"): number {
  return rows.reduce((acc, row) => acc + row.ledger[key], 0);
}

function Totals({ data }: { data: SalaryReport }) {
  const t = data.totals;
  return (
    <section aria-label="Payroll totals" className={styles.totals}>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Gross</span>
        <span className={styles.totalValue}>{formatRs(t.gross)}</span>
        <span className={styles.totalHint}>
          {t.staff} staff · incl. overtime {formatRs(t.overtime_pay)} ({t.overtime_hours} h)
        </span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Absence deductions</span>
        <span className={`${styles.totalValue} ${shared.danger}`}>− {formatAmount(t.absence_deduction)}</span>
        <span className={styles.totalHint}>{t.absent_days} absent days</span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Advances paid</span>
        <span className={styles.totalValue}>{formatRs(t.advance_paid)}</span>
        <span className={styles.totalHint}>part of salary, already paid</span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Tax (TDS)</span>
        <span className={styles.totalValue}>{formatRs(t.tds)}</span>
        <span className={styles.totalHint}>not applied yet</span>
      </div>
      <div className={`card ${styles.total} ${styles.totalNet}`}>
        <span className={styles.totalLabel}>Net payable</span>
        <span className={`${styles.totalValue} ${shared.ok}`}>{formatRs(t.net)}</span>
        <span className={styles.totalHint}>
          {t.paid_count} paid · {t.part_paid_count} part paid · {t.pending_count} pending · {formatRs(t.due)} due
        </span>
      </div>
    </section>
  );
}

function TrendChart({ data }: { data: SalaryReport }) {
  const trend = data.trend;
  const max = Math.max(1, ...trend.map((t) => t.net));
  const first = trend[0];
  const last = trend[trend.length - 1];
  const change = first && last ? percentChange(first.net, last.net) : null;
  const note =
    change === null || !first
      ? ""
      : change === 0
        ? `unchanged since ${monthName(first.month)}`
        : `${change > 0 ? "up" : "down"} ${Math.abs(change)}% since ${monthName(first.month)}`;
  const alt =
    first && last
      ? `Net payroll went from ${formatRs(first.net)} in ${monthLabel(first.month)} to ${formatRs(last.net)} in ${monthLabel(last.month)}`
      : "Net payroll trend";
  return (
    <section aria-labelledby="trend-h" className={`card ${styles.trend}`}>
      <div className={styles.trendHead}>
        <h2 id="trend-h" className={shared.cardTitle}>
          Net payroll, last {trend.length} months
        </h2>
        <span className={shared.note} style={{ fontSize: 13 }}>
          {note}
        </span>
      </div>
      <div role="img" aria-label={alt} className={styles.bars}>
        {trend.map((t, index) => {
          const current = index === trend.length - 1;
          return (
            <div key={monthKey(t.month)} className={styles.barCol} title={`${monthLabel(t.month)}: ${formatRs(t.net)}`}>
              <span className={styles.barLabel}>{formatLakh(t.net)}</span>
              <div
                className={current ? `${styles.bar} ${styles.barCurrent}` : styles.bar}
                style={{ height: `${Math.round((t.net / max) * 150)}px` }}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.barMonths} aria-hidden="true">
        {trend.map((t) => (
          <span key={monthKey(t.month)} className={styles.barMonth}>
            {monthName(t.month)}
          </span>
        ))}
      </div>
    </section>
  );
}

function DepartmentChart({ data, selected }: { data: SalaryReport; selected: number | null }) {
  const max = Math.max(1, ...data.by_department.map((d) => d.net));
  return (
    <section aria-labelledby="dept-h" className={`card ${styles.dept}`}>
      <h2 id="dept-h" className={shared.cardTitle}>
        Net pay by department
      </h2>
      {data.by_department.map((d) => {
        const on = selected === null || selected === d.department.id;
        const avg = d.staff ? Math.round(d.net / d.staff) : 0;
        return (
          <div key={d.department.id} className={styles.deptRow} title={`${d.department.name}: ${formatRs(d.net)} for ${d.staff} staff`}>
            <div className={styles.deptMeta}>
              <span>
                <span style={{ fontWeight: 600 }}>{d.department.name}</span>{" "}
                <span className={shared.muted}>
                  · {d.staff} staff · avg {formatRs(avg)}
                </span>
              </span>
              <span className="mono">{formatAmount(d.net)}</span>
            </div>
            <div className={styles.deptTrack} role="img" aria-label={`${d.department.name}: ${formatRs(d.net)}`}>
              <div className={on ? `${styles.deptBar} ${styles.deptBarOn}` : styles.deptBar} style={{ width: `${Math.round((d.net / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
