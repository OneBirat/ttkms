"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Icon } from "@/components/icons";
import { currentMonth, listMonths, listPayments } from "../api";
import { formatBsLong, monthKey, monthLabel, monthName, parseMonthKey, sameMonth } from "../_lib/calendar";
import { downloadText, printReceipt, registerCsv } from "../_lib/exports";
import { formatAmount, formatRs, matchesEmployee, paginate } from "../_lib/helpers";
import type { RegisterTypeFilter } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./report.module.css";
import shared from "./payroll.module.css";

const PAGE_SIZE = 25;
const TYPES: { value: RegisterTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "salary", label: "Salary" },
  { value: "advance", label: "Advance" },
];

function isType(value: string | null): value is RegisterTypeFilter {
  return TYPES.some((t) => t.value === value);
}

/** /people/payments: every salary and advance payment, newest first. No record form here. */
export function PaymentsRegisterScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const monthId = useId();
  const searchId = useId();

  const monthParam = params.get("month");
  const month = monthParam === "all" ? null : (parseMonthKey(monthParam ?? "") ?? currentMonth());
  const type: RegisterTypeFilter = isType(params.get("type")) ? (params.get("type") as RegisterTypeFilter) : "all";
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
  const register = usePayroll(() => listPayments({ month, type }), [month ? monthKey(month) : "all", type]);
  const data = register.data;
  const rows = useMemo(() => (data ? data.rows.filter((r) => matchesEmployee(r.employee, query)) : []), [data, query]);
  const paged = paginate(rows, page, PAGE_SIZE);
  const total = rows.reduce((sum, r) => sum + r.payment.amount, 0);
  const scopeLabel = month ? monthLabel(month) : "all months";
  const fileStem = `payments-${month ? monthKey(month) : "all"}${type === "all" ? "" : `-${type}`}`;

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={`Register of salary and advance payments · ${scopeLabel} · recorded from the employee account or the attendance scan`}
        actions={
          <div className={`${shared.row} ${styles.noPrint}`}>
            <button type="button" className="btn" disabled={!data} onClick={() => downloadText(`${fileStem}.csv`, registerCsv(rows))}>
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

      {register.error ? (
        <EmptyState icon="alert" title="Could not load payments" text={payrollErrorMessage(register.error)}>
          <button type="button" className="btn" onClick={register.reload}>
            Try again
          </button>
        </EmptyState>
      ) : !data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <section aria-label="Payment totals" className={styles.cards4}>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>{month ? `${monthName(month)} net payroll` : `${monthName(currentMonth())} net payroll`}</span>
              <span className={styles.totalValue}>{formatRs(data.totals.month_net)}</span>
              <span className={styles.totalHint}>{month && sameMonth(month, currentMonth()) ? "so far this month" : "all employees"}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Salary paid</span>
              <span className={`${styles.totalValue} ${shared.ok}`}>{formatRs(data.totals.salary_paid)}</span>
              <span className={styles.totalHint}>{scopeLabel}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Advances paid</span>
              <span className={styles.totalValue}>{formatRs(data.totals.advance_paid)}</span>
              <span className={styles.totalHint}>part of the month&apos;s salary</span>
            </div>
            <div className={`card ${styles.total} ${styles.totalNet}`}>
              <span className={styles.totalLabel}>Still due</span>
              <span className={`${styles.totalValue} ${data.totals.due > 0 ? shared.danger : shared.ok}`}>{formatRs(data.totals.due)}</span>
              <span className={styles.totalHint}>{month ? monthLabel(month) : monthLabel(currentMonth())}</span>
            </div>
          </section>

          <section aria-labelledby="reg-h" className={`card ${styles.sheet}`}>
            <div className={styles.sheetHead}>
              <h2 id="reg-h" className={shared.cardTitle}>
                Register
              </h2>
              <div className={`${styles.registerControls} ${styles.noPrint}`}>
                <label htmlFor={searchId} className={shared.srOnly}>
                  Search employee
                </label>
                <div className="field" style={{ width: 200 }}>
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
                <div role="group" aria-label="Payment type" className={styles.typeFilter}>
                  {TYPES.map((t) => (
                    <button key={t.value} type="button" className={shared.chip} aria-pressed={type === t.value} onClick={() => setParams({ type: t.value === "all" ? null : t.value })}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <label htmlFor={monthId} className={shared.srOnly}>
                  Month (BS)
                </label>
                <div className={`field ${shared.selectWrap} ${styles.monthField}`}>
                  <select id={monthId} value={month ? monthKey(month) : "all"} onChange={(event) => setParams({ month: event.target.value })}>
                    {(months.data ?? [currentMonth()]).map((m) => (
                      <option key={monthKey(m)} value={monthKey(m)}>
                        {monthLabel(m)}
                      </option>
                    ))}
                    <option value="all">All months</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={shared.tableWrap}>
              <table className={shared.table}>
                <caption className={shared.srOnly}>Payments, {scopeLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Employee</th>
                    <th scope="col">For month</th>
                    <th scope="col">Type</th>
                    <th scope="col">Paid by</th>
                    <th scope="col" className={shared.num}>
                      Amount
                    </th>
                    <th scope="col">Recorded by</th>
                    <th scope="col">
                      <span className={shared.srOnly}>Receipt</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={shared.empty}>
                        No payments match.
                      </td>
                    </tr>
                  ) : (
                    paged.items.map(({ payment: p, employee }) => (
                      <tr key={p.id}>
                        <td>
                          {formatBsLong(p.date.bs)}
                          <span className={shared.note}> · {p.date.ad}</span>
                        </td>
                        <td>
                          <Link href={`/people/employees/${employee.id}`} className={styles.empCell}>
                            <span className={styles.empName}>{employee.full_name}</span>
                            <span className={styles.empSub}>
                              {employee.code} · {employee.department?.name ?? "—"}
                            </span>
                          </Link>
                        </td>
                        <td>{monthLabel(p.month)}</td>
                        <td>
                          <span className={p.type === "advance" ? shared.pillAdvance : shared.pillSalary}>{p.type === "advance" ? "Advance" : "Salary"}</span>
                        </td>
                        <td>
                          {p.mode === "bank" ? "Bank" : "Cash"}
                          {p.reference ? <span className={styles.refText}>{p.reference}</span> : null}
                        </td>
                        <td className={`${shared.num} ${shared.kvStrong}`}>{formatAmount(p.amount)}</td>
                        <td>
                          {p.recorded_by}
                          {p.source === "scan" ? <span className={shared.note}> · scan</span> : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                              if (!printReceipt(employee, p, null)) {
                                window.alert("The browser blocked the receipt window. Allow pop-ups for this site and try again.");
                              }
                            }}
                          >
                            Receipt
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={5} style={{ textAlign: "left" }}>
                      Total · {rows.length} payment{rows.length === 1 ? "" : "s"}
                    </th>
                    <td className={`${shared.num} ${shared.ok}`}>{formatAmount(total)}</td>
                    <td colSpan={2} />
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
                  summary={`Showing ${(paged.page - 1) * PAGE_SIZE + 1}–${Math.min(paged.page * PAGE_SIZE, rows.length)} of ${rows.length}`}
                />
              </div>
            ) : null}
            <span className={styles.sheetNote}>
              Payments are recorded from the employee account (Pay salary, Give advance, Record payment) and from the
              attendance scan pop-up. Exports include everything in the current filter.
            </span>
          </section>
        </>
      )}
    </>
  );
}
