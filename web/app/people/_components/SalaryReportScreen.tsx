"use client";

import { PageBranchSelect } from "@/components/PageBranchSelect";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Icon } from "@/components/icons";
import { currentMonth, getSalaryReport, listDepartments, listMonths, salaryReportExportUrl } from "../api";
import { MonthStatusPill } from "./MonthStatusPill";
import { Avatar } from "./Avatar";
import { useReportBranch } from "../_lib/useBranchScope";
import { withBranch } from "@/lib/branchContext";
import { monthKey, monthLabel, parseMonthKey, sameMonth } from "../_lib/months";
import {
  formatAmount,
  formatDeduction,
  formatPaidDays,
  formatRs,
  matchesEmployee,
  paginate,
  sortRows,
  thumbUrl,
} from "../_lib/helpers";
import type { ReportSort, SalaryReport } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import { AttendanceCounts } from "./AttendanceCounts";
import { UNMARKED_HREF, unmarkedWarningText } from "../_lib/monthDetail";
import {
  NO_SELECTION,
  allShownSelected,
  printOrder,
  selectShown,
  selectionIn,
  selectionScope,
  slipPrintedTitle,
  toggleRow,
  toggleShown,
  type SelectionState,
  type SlipSelection,
} from "../_lib/payslipSelection";
import { PayslipPrintBar } from "./PayslipPrintBar";
import { useSession } from "@/lib/session";
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
  // The ONE active branch (switched in the shell; the server scopes the report to it).
  const branchScope = useReportBranch();

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
  const report = usePayroll(
    () => getSalaryReport(month, department),
    [monthKey(month), department, branchScope.branchId],
  );

  const data = report.data;
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter((row) => matchesEmployee(row.employee, query));
    return sortRows(rows, sort, departments.data ?? []);
  }, [data, query, sort, departments.data]);
  const paged = paginate(filteredRows, page, PAGE_SIZE);

  // Pay slips to print: ticks survive the department chip, search and sort; a new branch or
  // month starts with none (the ticks are only read back for the scope they were made in).
  const { user } = useSession();
  const scopeKey = selectionScope(branchScope.branchId, month);
  const [picked, setPicked] = useState<SelectionState>({ scope: scopeKey, rows: NO_SELECTION });
  const selection = selectionIn(picked, scopeKey);
  const changeSelection = (change: (current: SlipSelection) => SlipSelection) =>
    setPicked((state) => ({ scope: scopeKey, rows: change(selectionIn(state, scopeKey)) }));
  const slipRows = useMemo(
    () => printOrder(selection, data?.rows ?? [], sort, departments.data ?? []),
    [selection, data, sort, departments.data],
  );
  const allTicked = allShownSelected(selection, filteredRows);

  // A print / preview tab was opened: when this tab is looked at again, refetch the rows so
  // "Slip printed" shows up.
  const slipTabOpened = useRef(false);
  const reloadReport = report.reload;
  useEffect(() => {
    const refetch = () => {
      if (slipTabOpened.current && document.visibilityState === "visible") reloadReport();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [reloadReport]);
  const deptName = department !== null ? (departments.data ?? []).find((d) => d.id === department)?.name : null;
  const scope = `${branchScope.label} · ${deptName ?? "all departments"}`;

  return (
    <>
      <PageHeader
        title={withBranch("Salary report", { name: branchScope.label })}
        subtitle={`${monthLabel(month)} payroll`}
        actions={
          <div className={`${shared.row} ${styles.noPrint}`}>
            <PageBranchSelect />
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
            <button type="button" className="btn" disabled={!data} onClick={() => window.location.assign(salaryReportExportUrl(month, "xlsx", department))}>
              <Icon name="download" size={16} />
              Excel
            </button>
            <button type="button" className="btn" disabled={!data} onClick={() => window.open(salaryReportExportUrl(month, "pdf", department), "_blank", "noopener")}>
              <Icon name="print" size={16} />
              PDF
            </button>
          </div>
        }
      />

      {/* One line that scrolls sideways (swipe, trackpad, or the arrow keys when focused). */}
      <section aria-label="Departments" tabIndex={0} className={`${styles.chipScroll} ${styles.noPrint}`}>
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
          <UnmarkedWarning data={data} />

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

            <PayslipPrintBar
              rows={slipRows}
              shownCount={filteredRows.length}
              branchId={branchScope.branchId}
              month={month}
              userId={user?.id ?? null}
              onSelectShown={() => changeSelection((current) => selectShown(current, filteredRows))}
              onClear={() => changeSelection(() => NO_SELECTION)}
              onOpened={() => {
                slipTabOpened.current = true;
              }}
            />

            <div className={shared.tableWrap}>
              <table className={shared.table}>
                <caption className={shared.srOnly}>
                  Payroll sheet for {monthLabel(month)}, {scope}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={`${styles.tickCol} ${styles.noPrint}`}>
                      <label className={styles.tick}>
                        <input
                          type="checkbox"
                          aria-label="Select all shown employees"
                          checked={allTicked}
                          disabled={filteredRows.length === 0}
                          onChange={() => changeSelection((current) => toggleShown(current, filteredRows))}
                        />
                      </label>
                    </th>
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
                    paged.items.map((row) => {
                      const { employee, ledger } = row;
                      const ticked = selection.has(employee.id);
                      const printedTitle = slipPrintedTitle(row);
                      return (
                        <tr key={employee.id} className={ticked ? styles.rowTicked : undefined}>
                          <td className={`${styles.tickCol} ${styles.noPrint}`}>
                            <label className={styles.tick}>
                              <input
                                type="checkbox"
                                aria-label={`Print pay slip for ${employee.full_name}`}
                                checked={ticked}
                                onChange={() => changeSelection((current) => toggleRow(current, row))}
                              />
                            </label>
                          </td>
                          <td>
                            <Link href={`/people/employees/${employee.id}`} className={`${styles.empCell} ${styles.empCellPhoto}`}>
                              <Avatar name={employee.full_name} photoUrl={thumbUrl(employee)} size={32} />
                              <span className={styles.empText}>
                                <span className={styles.empName}>{employee.full_name}</span>
                                <span className={styles.empSub}>
                                  {employee.code} · {employee.designation ?? "—"} · {ledger.pay_type === "monthly" ? "Monthly" : `Daily ${formatAmount(ledger.rate)}/day`}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td>{employee.department?.name ?? "—"}</td>
                          <td className={shared.num}>
                            {formatPaidDays(ledger.paid_days, ledger.attendance.days_in_month)}
                            <AttendanceCounts attendance={ledger.attendance} short className={styles.rowCounts} />
                          </td>
                          <td className={shared.num} title={ledger.overtime_pay ? `incl. overtime ${formatRs(ledger.overtime_pay)}` : undefined}>
                            {formatAmount(ledger.earnings)}
                          </td>
                          <td className={shared.num}>{formatDeduction(ledger.absence_deduction)}</td>
                          <td className={shared.num}>{formatDeduction(ledger.advance_paid)}</td>
                          <td className={`${shared.num} ${shared.kvStrong}`}>{formatAmount(ledger.net)}</td>
                          <td>
                            <span className={styles.statusCell}>
                              <MonthStatusPill ledger={ledger} />
                              {printedTitle ? (
                                <span className={styles.slipPrinted} title={printedTitle}>
                                  <Icon name="check" size={14} />
                                  Slip printed
                                  <span className={shared.srOnly}> · {printedTitle}</span>
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${styles.tickCol} ${styles.noPrint}`} />
                    <th scope="row" colSpan={3} style={{ textAlign: "left" }}>
                      Total · {filteredRows.length} staff · {scope}
                    </th>
                    <td className={shared.num}>{formatAmount(sum(filteredRows, "earnings"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "absence_deduction"))}</td>
                    <td className={shared.num}>{formatDeduction(sum(filteredRows, "advance_paid"))}</td>
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
              Gross includes overtime. Monthly staff: absence = salary ÷ 30 × (absent + not marked days) (a fixed 30); Saturdays are
              paid. Not marked = a past working day without an attendance record: it is not paid until someone marks it.
              Daily wage: wage × days present. Advances already paid are part of the net; the status compares net
              with every payment of the month. Exports include everyone in the current filter.
            </span>
          </section>
        </>
      )}
    </>
  );
}

function sum(rows: SalaryReport["rows"], key: "earnings" | "absence_deduction" | "advance_paid" | "net" | "due"): number {
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
        <span className={styles.totalHint}>
          {t.absent_days} absent days
          {t.not_marked_days > 0 ? <b className={shared.danger}> · {t.not_marked_days} not marked days</b> : null}
        </span>
      </div>
      <div className={`card ${styles.total}`}>
        <span className={styles.totalLabel}>Advances paid</span>
        <span className={styles.totalValue}>{formatRs(t.advance_paid)}</span>
        <span className={styles.totalHint}>part of salary, already paid</span>
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

/** "3 employees have unmarked days this month" + the way to Mark attendance (Not marked filter). */
function UnmarkedWarning({ data }: { data: SalaryReport }) {
  const text = unmarkedWarningText(data.totals);
  if (!text) return null;
  return (
    <p role="status" className={shared.unmarkedWarning} data-testid="unmarked-warning">
      <span>
        {text} They are not paid for those days ({data.totals.not_marked_days} in all) until the days are marked.
      </span>
      <Link href={UNMARKED_HREF}>Mark attendance · Not marked</Link>
    </p>
  );
}
