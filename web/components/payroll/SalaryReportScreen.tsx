"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { Icon } from "@/components/icons";
import { currentMonth, getSalaryReport, listDepartments, listPayrollMonths, markPendingPaid } from "./api";
import { formatBsShort, monthKey, monthLabel, monthName, parseMonthKey } from "./calendar";
import { bankSheetCsv, downloadText, payrollSheetCsv } from "./exports";
import {
  formatDays,
  formatDeduction,
  formatLakh,
  formatPaidDays,
  formatRs,
  matchesEmployee,
  paginate,
  percentChange,
  sortRows,
} from "./helpers";
import type { ReportSort, SalaryReport } from "./types";
import { payrollErrorMessage, usePayroll } from "./usePayroll";
import styles from "./report.module.css";
import shared from "./payroll.module.css";

const PAGE_SIZE = 25;
const SORTS: { value: ReportSort; label: string }[] = [
  { value: "dept", label: "Department, then name" },
  { value: "net", label: "Highest net pay" },
  { value: "unpaid", label: "Most unpaid days" },
  { value: "name", label: "Name" },
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

  const months = usePayroll(listPayrollMonths, []);
  const departments = usePayroll(listDepartments, []);
  const report = usePayroll(() => getSalaryReport(month, department), [monthKey(month), department]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const data = report.data;
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter((row) => matchesEmployee(row.employee, query));
    return sortRows(rows, sort, departments.data ?? []);
  }, [data, query, sort, departments.data]);
  const paged = paginate(filteredRows, page, PAGE_SIZE);
  const allStaff = useMemo(() => data?.run.payslips.length ?? 0, [data]);
  const deptName = department !== null ? (departments.data ?? []).find((d) => d.id === department)?.name : null;
  const scope = deptName ?? "all departments";

  const markPaid = async () => {
    setBusy(true);
    try {
      const count = await markPendingPaid(month, department);
      setToast(`${count} ${count === 1 ? "payslip" : "payslips"} marked paid for ${monthLabel(month)}.`);
    } catch (err) {
      setToast(payrollErrorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const fileStem = `salary-${monthKey(month)}${deptName ? `-${deptName.toLowerCase().replace(/\s+/g, "-")}` : ""}`;
  const pending = data?.totals.pending_count ?? 0;

  return (
    <>
      <PageHeader
        title="Salary report"
        subtitle={`${monthLabel(month)} payroll · paid days come from the attendance report · ${scope}`}
        actions={
          <div className={`${shared.row} ${styles.noPrint}`}>
            <label htmlFor={monthSelectId} className={shared.srOnly}>
              Month (BS)
            </label>
            <div className={`field ${shared.selectWrap} ${styles.monthField}`}>
              <select
                id={monthSelectId}
                value={monthKey(month)}
                onChange={(event) => setParams({ month: event.target.value })}
              >
                {(months.data ?? [month]).map((m) => (
                  <option key={monthKey(m)} value={monthKey(m)}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              disabled={!data}
              onClick={() => downloadText(`${fileStem}.csv`, payrollSheetCsv(filteredRows))}
            >
              <Icon name="download" size={16} />
              Excel
            </button>
            <button type="button" className="btn" disabled={!data} onClick={() => window.print()}>
              <Icon name="print" size={16} />
              PDF
            </button>
            <button
              type="button"
              className="btn"
              disabled={!data}
              onClick={() => downloadText(`${fileStem}-bank-transfer.csv`, bankSheetCsv(filteredRows))}
            >
              Bank transfer sheet
            </button>
          </div>
        }
      />

      <section aria-label="Departments" className={`${styles.chips} ${styles.noPrint}`}>
        <button
          type="button"
          className={shared.chip}
          aria-pressed={department === null}
          onClick={() => setParams({ dept: null })}
        >
          <span className={shared.chipName}>All departments</span>
          <span>{allStaff}</span>
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

      {toast ? (
        <p className={shared.formOk} role="status">
          {toast}
        </p>
      ) : null}

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
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={pending === 0 || busy}
                  onClick={() => setConfirm(true)}
                >
                  Mark pending as paid
                </button>
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
                    <th scope="col">Department</th>
                    <th scope="col">Pay type</th>
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
                      Advance
                    </th>
                    <th scope="col" className={shared.num}>
                      Net pay
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
                    paged.items.map(({ employee, payslip }) => (
                      <tr key={payslip.id}>
                        <td>
                          <Link href={`/payroll/employees/${employee.id}`} className={styles.empCell}>
                            <span className={styles.empName}>{employee.full_name}</span>
                            <span className={styles.empSub}>
                              {employee.code} · {employee.designation ?? "—"}
                            </span>
                          </Link>
                        </td>
                        <td>{employee.department?.name ?? "—"}</td>
                        <td>
                          {payslip.pay_type === "monthly" ? "Monthly" : `Daily · ${formatRs(payslip.rate).slice(3)}/day`}
                        </td>
                        <td className={shared.num}>{formatPaidDays(payslip.paid_days, payslip.days_in_month)}</td>
                        <td className={shared.num}>{formatRs(payslip.gross).slice(3)}</td>
                        <td className={shared.num}>{formatDeduction(payslip.absence_deduction)}</td>
                        <td className={shared.num}>{formatDeduction(payslip.advance_recovered)}</td>
                        <td className={`${shared.num} ${shared.kvStrong}`}>{formatRs(payslip.net_pay).slice(3)}</td>
                        <td>
                          {payslip.status === "paid" && payslip.paid_on ? (
                            <Pill status="paid" label={`Paid ${formatBsShort(payslip.paid_on.bs)}`} />
                          ) : (
                            <Pill status="pending" />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} style={{ textAlign: "left" }}>
                      Total · {filteredRows.length} staff
                    </th>
                    <td className={shared.num}>{formatRs(sum(filteredRows, "gross")).slice(3)}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "absence_deduction"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "advance_recovered"))}</td>
                    <td className={`${shared.num} ${shared.ok}`}>{formatRs(sum(filteredRows, "net_pay")).slice(3)}</td>
                    <td />
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
              Monthly staff: paid days = days in month − absences − ½ per half day; leave and Saturdays are
              paid. Daily wage: pay = wage × days present. With 100+ staff the sheet pages at 25 rows;
              exports include everyone in the current filter.
            </span>
          </section>
        </>
      )}

      <Modal open={confirm} title="Mark pending as paid" onClose={() => setConfirm(false)} size="sm">
        <p>
          Mark {pending} pending {pending === 1 ? "payslip" : "payslips"} for {monthLabel(month)}
          {deptName ? ` in ${deptName}` : ""} as paid today? Advance recoveries on those payslips are
          recorded at the same time.
        </p>
        <div className={shared.footerButtons}>
          <button type="button" className="btn" onClick={() => setConfirm(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void markPaid()} disabled={busy}>
            {busy ? "Saving…" : `Mark ${pending} as paid`}
          </button>
        </div>
      </Modal>
    </>
  );
}

function sum(rows: SalaryReport["rows"], key: "gross" | "absence_deduction" | "advance_recovered" | "net_pay"): number {
  return rows.reduce((acc, row) => acc + row.payslip[key], 0);
}

function Totals({ data }: { data: SalaryReport }) {
  const t = data.totals;
  return (
    <section aria-label="Payroll totals" className={styles.totals}>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Gross salary</span>
        <span className={styles.totalValue}>{formatRs(t.gross)}</span>
        <span className={styles.totalHint}>{t.staff} staff</span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Absence deductions</span>
        <span className={`${styles.totalValue} ${shared.danger}`}>− {formatRs(t.absence_deduction).slice(3)}</span>
        <span className={styles.totalHint}>{formatDays(t.unpaid_days)} unpaid days</span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Advances recovered</span>
        <span className={styles.totalValue}>− {formatRs(t.advance_recovered).slice(3)}</span>
        <span className={styles.totalHint}>{formatRs(t.advance_outstanding)} still outstanding</span>
      </div>
      <div className={`card ${styles.total} ${styles.totalNet}`}>
        <span className={styles.totalLabel}>Net payable</span>
        <span className={`${styles.totalValue} ${shared.ok}`}>{formatRs(t.net_pay)}</span>
        <span className={styles.totalHint}>
          {t.paid_count} paid · {t.pending_count} pending
        </span>
      </div>
    </section>
  );
}

function TrendChart({ data }: { data: SalaryReport }) {
  const trend = data.trend;
  const max = Math.max(1, ...trend.map((t) => t.net_pay));
  const first = trend[0];
  const last = trend[trend.length - 1];
  const change = first && last ? percentChange(first.net_pay, last.net_pay) : null;
  const note =
    change === null || !first
      ? ""
      : change === 0
        ? `unchanged since ${monthName(first.month)}`
        : `${change > 0 ? "up" : "down"} ${Math.abs(change)}% since ${monthName(first.month)}`;
  const alt = first && last
    ? `Net payroll went from ${formatRs(first.net_pay)} in ${monthLabel(first.month)} to ${formatRs(last.net_pay)} in ${monthLabel(last.month)}`
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
            <div
              key={monthKey(t.month)}
              className={styles.barCol}
              title={`${monthLabel(t.month)}: ${formatRs(t.net_pay)}`}
            >
              <span className={styles.barLabel}>{formatLakh(t.net_pay)}</span>
              <div
                className={current ? `${styles.bar} ${styles.barCurrent}` : styles.bar}
                style={{ height: `${Math.round((t.net_pay / max) * 150)}px` }}
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
  const max = Math.max(1, ...data.by_department.map((d) => d.net_pay));
  return (
    <section aria-labelledby="dept-h" className={`card ${styles.dept}`}>
      <h2 id="dept-h" className={shared.cardTitle}>
        Net pay by department
      </h2>
      {data.by_department.map((d) => {
        const on = selected === null || selected === d.department.id;
        const avg = d.staff ? Math.round(d.net_pay / d.staff) : 0;
        return (
          <div
            key={d.department.id}
            className={styles.deptRow}
            title={`${d.department.name}: ${formatRs(d.net_pay)} for ${d.staff} staff`}
          >
            <div className={styles.deptMeta}>
              <span>
                <span style={{ fontWeight: 600 }}>{d.department.name}</span>{" "}
                <span className={shared.muted}>
                  · {d.staff} staff · avg {formatRs(avg)}
                </span>
              </span>
              <span className="mono">{formatRs(d.net_pay).slice(3)}</span>
            </div>
            <div
              className={styles.deptTrack}
              role="img"
              aria-label={`${d.department.name}: ${formatRs(d.net_pay)}`}
            >
              <div
                className={on ? `${styles.deptBar} ${styles.deptBarOn}` : styles.deptBar}
                style={{ width: `${Math.round((d.net_pay / max) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
