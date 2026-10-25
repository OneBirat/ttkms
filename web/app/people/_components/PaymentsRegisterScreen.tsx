"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import { BSDateRangePicker, BSDateText } from "@/components/date";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Icon } from "@/components/icons";
import { currentMonth, listBranches, listDepartments, listPayments, receiptUrl, registerExportUrl } from "../api";
import { BranchSwitcher } from "./BranchSwitcher";
import { useReportBranch, waitForBranch } from "../_lib/useBranchScope";
import { formatBs, isValidBs } from "@/lib/bs";
import { monthLabel, monthName, monthStart, rangeFor } from "../_lib/months";
import { formatAmount, formatRs, matchesEmployee, paginate } from "../_lib/helpers";
import { REGISTER_SORTS, displayRows, isRegisterSort } from "../_lib/register";
import { monthsText } from "../_lib/settle";
import type { DateRange, PaymentsRegister, RegisterSort, RegisterTypeFilter } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import type { Payment } from "../types";
import { VoidPaymentDialog, VoidedNote, useCanVoid } from "./VoidPaymentDialog";
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

type Ask = { ext: "xlsx" | "pdf" } | null;

/**
 * /people/payments "Payment reports" (design Payments.dc.html): every salary and advance
 * payment in a BS date range, filtered by department (chips) and sorted (Date / Department /
 * Employee / Amount; Department groups the rows with a subtotal each). ?dept=&sort= live in
 * the URL. Excel and PDF download exactly that range, department and sort; a range reaching
 * into a previous month asks first.
 */
export function PaymentsRegisterScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchId = useId();
  const branchSelectId = useId();
  const branches = usePayroll(listBranches, []);
  const branchScope = useReportBranch(branches.data ?? []);

  const defaults = useMemo(() => rangeFor("last_30"), []);
  const from_bs = params.get("from") ?? defaults.from_bs;
  const to_bs = params.get("to") ?? defaults.to_bs;
  const range: DateRange = { from_bs, to_bs };
  const type: RegisterTypeFilter = isType(params.get("type")) ? (params.get("type") as RegisterTypeFilter) : "all";
  const query = params.get("q") ?? "";
  const deptParam = Number(params.get("dept") ?? "0");
  const departmentId: number | null = Number.isInteger(deptParam) && deptParam > 0 ? deptParam : null;
  const sort: RegisterSort = isRegisterSort(params.get("sort")) ? (params.get("sort") as RegisterSort) : "date";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  // "Show voided" (off by default): voided payments listed struck through, never in a total.
  const showVoided = params.get("voided") === "1";
  const canVoid = useCanVoid();
  const [voiding, setVoiding] = useState<{ payment: Payment; name: string } | null>(null);
  // Salary payment groups whose per-month split is open (by the entry's payment id).
  const [openSplits, setOpenSplits] = useState<Set<number>>(() => new Set());
  const toggleSplit = (id: number) =>
    setOpenSplits((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const validRange = isValidBs(from_bs) && isValidBs(to_bs);
  const rangeBad = validRange && from_bs > to_bs;
  const [ask, setAsk] = useState<Ask>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

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
  const setRange = (r: DateRange) => setParams({ from: r.from_bs, to: r.to_bs });

  const departments = usePayroll(listDepartments, []);
  const register = usePayroll(
    () =>
      !branchScope.ready
        ? waitForBranch<PaymentsRegister>()
        : listPayments({
        from_bs: validRange && !rangeBad ? from_bs : null,
        to_bs: validRange && !rangeBad ? to_bs : null,
        type,
        branch_id: branchScope.branchId,
        department_id: departmentId,
        sort,
        show_voided: showVoided,
      }),
    [validRange && !rangeBad ? from_bs : "", validRange && !rangeBad ? to_bs : "", type, branchScope.branchId, branchScope.ready, departmentId, sort, showVoided],
  );
  const data = register.data;
  const rows = useMemo(() => (data ? data.rows.filter((r) => matchesEmployee(r.employee, query)) : []), [data, query]);
  // Grouping (sort = Department) adds heading and subtotal lines; pages count those so a subtotal stays with its group.
  const shown = useMemo(() => displayRows(rows, sort), [rows, sort]);
  const paged = paginate(shown, page, PAGE_SIZE);
  const counted = rows.filter((r) => !r.payment.voided);
  const total = counted.reduce((sum, r) => sum + r.payment.amount, 0);
  const totalSalary = counted.filter((r) => r.payment.kind === "salary").reduce((sum, r) => sum + r.payment.amount, 0);
  // Chips: every department with its payment count in the range (whichever department is chosen).
  const countOf = (id: number | null) => data?.by_department.find((d) => (d.department?.id ?? null) === id)?.count ?? 0;
  const allCount = data?.by_department.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const deptName = data?.department?.name ?? null;
  const rangeText = `${from_bs} → ${to_bs}`;
  const monthStartBs = monthStart(currentMonth()).bs;
  const previousMonth = from_bs < monthStartBs;
  const settle = data?.totals.month ?? currentMonth();

  // Files come from the server with the same From/To, type, branch, department and sort.
  const download = (ext: "xlsx" | "pdf", r: DateRange) => {
    if (!data) return;
    setAsk(null);
    if (r.from_bs !== from_bs || r.to_bs !== to_bs) setRange(r);
    const url = registerExportUrl(
      { from_bs: r.from_bs, to_bs: r.to_bs, type, branch_id: branchScope.branchId, department_id: departmentId, sort },
      ext,
    );
    const dept = data.department;
    const scope = `${branchScope.label}${dept ? ` · ${dept.name}` : ""} · ${r.from_bs} → ${r.to_bs}`;
    if (ext === "xlsx") {
      window.location.assign(url);
      setToast(`Excel downloading · ${scope}`);
    } else if (window.open(url, "_blank", "noopener")) {
      setToast(`PDF opened in a new tab · ${scope}`);
    } else {
      setToast("The browser blocked the PDF tab. Allow pop-ups for this site and try again.");
    }
  };
  const tryDownload = (ext: "xlsx" | "pdf") => {
    if (!validRange || rangeBad) return;
    if (previousMonth) setAsk({ ext });
    else download(ext, range);
  };

  return (
    <>
      <PageHeader
        title="Payment reports"
        subtitle="Every salary and advance payment in one place. Payments are recorded from each employee's account (Pay salary / Give advance)."
        actions={
          <div className={styles.downloads}>
            <div className={shared.row} style={{ gap: 8 }}>
              <button type="button" className={`btn ${styles.xlsBtn}`} disabled={!data || rangeBad} onClick={() => tryDownload("xlsx")}>
                <Icon name="download" size={16} />
                Excel
              </button>
              <button type="button" className={`btn ${styles.pdfBtn}`} disabled={!data || rangeBad} onClick={() => tryDownload("pdf")}>
                <Icon name="print" size={16} />
                PDF
              </button>
            </div>
            <span className={shared.note}>
              Downloads the report as shown: <b>{branchScope.label}</b> · <b>{rangeText}</b>
              {deptName ? <b> · {deptName}</b> : null} · sorted by {REGISTER_SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
            </span>
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
          <section aria-label="Totals" className={styles.cards4}>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>{monthName(settle)} net payroll</span>
              <span className={styles.totalValue}>{formatRs(data.totals.month_net)}</span>
              <span className={styles.totalHint}>
                {data.totals.staff} staff · {branchScope.label}
                {deptName ? ` · ${deptName}` : ""}
              </span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Salary paid</span>
              <span className={`${styles.totalValue} ${shared.ok}`}>{formatRs(data.totals.salary_paid)}</span>
              <span className={styles.totalHint}>{monthLabel(settle)}</span>
            </div>
            <div className={`card ${styles.total}`}>
              <span className={styles.totalLabel}>Advances paid</span>
              <span className={styles.totalValue} style={{ color: "var(--pill-leave-fg)" }}>
                {formatRs(data.totals.advance_paid)}
              </span>
              <span className={styles.totalHint}>counted as part of {monthName(settle)} salary</span>
            </div>
            <div className={`card ${styles.total} ${styles.totalDue}`}>
              <span className={styles.totalLabel}>Still due</span>
              <span className={styles.totalValue} style={{ color: "var(--pill-low-fg)" }}>
                {formatRs(data.totals.due)}
              </span>
              <span className={styles.totalHint}>to pay for {monthLabel(settle)}</span>
            </div>
          </section>

          <section aria-labelledby="reg-h" className={`card ${styles.sheet}`}>
            <div className={styles.sheetHead}>
              <h2 id="reg-h" className={shared.cardTitle} style={{ marginRight: "auto" }}>
                Payment register · {counted.length}
              </h2>
              <label className={shared.note} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={showVoided} onChange={(event) => setParams({ voided: event.target.checked ? "1" : null })} />
                Show voided
              </label>
              <label htmlFor={searchId} className={shared.srOnly}>
                Search employee
              </label>
              <div className="field" style={{ width: 200, minHeight: 40 }}>
                <input id={searchId} type="search" placeholder="Search employee" value={query} onChange={(event) => setParams({ q: event.target.value })} autoComplete="off" />
              </div>
              <div role="group" aria-label="Type filter" className={styles.segment}>
                {TYPES.map((t) => (
                  <button key={t.value} type="button" className={styles.segmentOption} aria-pressed={type === t.value} onClick={() => setParams({ type: t.value === "all" ? null : t.value })}>
                    {t.label}
                  </button>
                ))}
              </div>
              <label className={styles.sortField}>
                Sort
                <select value={sort} onChange={(event) => setParams({ sort: event.target.value === "date" ? null : event.target.value })}>
                  {REGISTER_SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.value === "date" ? "Date (newest first)" : s.value === "amount" ? "Amount (high → low)" : s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div role="group" aria-label="Department" className={styles.chips} style={{ padding: "0 10px" }}>
              <button type="button" className={styles.presetChip} aria-pressed={departmentId === null} onClick={() => setParams({ dept: null })}>
                All <b>{allCount}</b>
              </button>
              {(departments.data ?? []).map((d) => (
                <button key={d.id} type="button" className={styles.presetChip} aria-pressed={departmentId === d.id} onClick={() => setParams({ dept: String(d.id) })}>
                  {d.name} <b>{countOf(d.id)}</b>
                </button>
              ))}
              {countOf(null) > 0 ? <span className={shared.note}>+ {countOf(null)} without a department</span> : null}
            </div>

            <div className={styles.rangeRow}>
              <BranchSwitcher scope={branchScope} id={branchSelectId} />
              <BSDateRangePicker value={{ from: from_bs, to: to_bs }} onChange={(r) => setRange({ from_bs: r.from, to_bs: r.to })} size="sm" />
              {rangeBad ? <span className={shared.warn}>&quot;From&quot; is after &quot;To&quot; — swap the dates.</span> : null}
              {!validRange ? <span className={shared.warn}>Pick both dates.</span> : null}
              <span className={shared.note} style={{ marginLeft: "auto" }}>
                {counted.length} payments · {rangeText}
                {deptName ? ` · ${deptName}` : ""}
              </span>
            </div>

            <div className={shared.tableWrap}>
              <table className={shared.table} style={{ minWidth: 760 }}>
                <caption className={shared.srOnly}>Payments from {formatBs(from_bs)} to {formatBs(to_bs)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date (BS)</th>
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
                        No payments match these filters.
                      </td>
                    </tr>
                  ) : (
                    paged.items.map((item) => {
                      if (item.kind === "group") {
                        const g = item.group;
                        return (
                          <tr key={`g-${g.department?.id ?? "none"}`} className={styles.groupRow}>
                            <th scope="rowgroup" colSpan={8}>
                              {g.department?.name ?? "No department"} · {g.rows.length} payment{g.rows.length === 1 ? "" : "s"}
                            </th>
                          </tr>
                        );
                      }
                      if (item.kind === "subtotal") {
                        const g = item.group;
                        return (
                          <tr key={`s-${g.department?.id ?? "none"}`} className={styles.subtotalRow}>
                            <th scope="row" colSpan={5} style={{ textAlign: "left" }}>
                              Subtotal · {g.department?.name ?? "No department"} · Salary {formatAmount(g.salary)} · Advances {formatAmount(g.advances)}
                            </th>
                            <td className={shared.num}>{formatAmount(g.total)}</td>
                            <td colSpan={2} />
                          </tr>
                        );
                      }
                      const { payment: p, employee, split } = item.row;
                      const multi = split && split.length > 1 ? split : null;
                      const splitOpen = multi !== null && openSplits.has(p.id);
                      return (
                      <Fragment key={p.id}>
                      <tr className={p.voided ? shared.voidedRow : undefined}>
                        <td>
                          <BSDateText value={p.date.bs} />
                        </td>
                        <td>
                          <Link href={`/people/employees/${employee.id}`} className={styles.empCell}>
                            <span className={styles.empName}>{employee.full_name}</span>
                            <span className={styles.empSub}>
                              {employee.code} · {employee.department?.name ?? "—"}
                            </span>
                          </Link>
                        </td>
                        <td>
                          {multi ? (
                            <button type="button" className={styles.splitToggle} aria-expanded={splitOpen} onClick={() => toggleSplit(p.id)}>
                              {monthsText(multi.map((x) => x.month))} {multi[multi.length - 1].month.bs_year}
                              <span className={styles.splitCount}>
                                {multi.length} months {splitOpen ? "▾" : "▸"}
                              </span>
                            </button>
                          ) : (
                            monthLabel(p.month)
                          )}
                        </td>
                        <td>
                          <span className={p.kind === "advance" ? shared.pillAdvance : shared.pillSalary}>{p.kind === "advance" ? "Advance" : "Salary"}</span>
                        </td>
                        <td>
                          {p.payment_mode.name}
                          {p.reference || p.note ? <span className={styles.refText}>{[p.reference, p.note].filter(Boolean).join(" · ")}</span> : null}
                          <VoidedNote payment={p} />
                        </td>
                        <td className={`${shared.num} ${shared.kvStrong} ${p.voided ? shared.voidedAmount : ""}`}>{formatAmount(p.amount)}</td>
                        <td style={{ color: "#3e4a52" }}>
                          {p.recorded_by}
                          {p.source === "scan" ? <span className={shared.note}> · scan</span> : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                              if (!window.open(receiptUrl(p.id), "_blank", "noopener")) {
                                window.alert("The browser blocked the receipt tab. Allow pop-ups for this site and try again.");
                              }
                            }}
                          >
                            Receipt
                          </button>
                          {canVoid && !p.voided ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setVoiding({ payment: p, name: employee.full_name })}>
                              Void
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {splitOpen && multi
                        ? multi.map((x) => (
                            <tr key={`split-${x.payment_id}`} className={styles.splitRow} data-voided={p.voided || undefined}>
                              <td />
                              <td className={shared.note}>{p.receipt_no}</td>
                              <td>{monthLabel(x.month)}</td>
                              <td colSpan={2} className={shared.note}>
                                part of this payment
                              </td>
                              <td className={shared.num}>{formatAmount(x.amount)}</td>
                              <td colSpan={2} />
                            </tr>
                          ))
                        : null}
                      </Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={5} style={{ textAlign: "left" }}>
                      Total · {counted.length} payment{counted.length === 1 ? "" : "s"}
                      {deptName ? ` · ${deptName}` : ""} · Salary {formatAmount(totalSalary)} · Advances {formatAmount(total - totalSalary)}
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
                  summary={`Showing ${(paged.page - 1) * PAGE_SIZE + 1}–${Math.min(paged.page * PAGE_SIZE, shown.length)} of ${shown.length} lines · ${counted.length} payments`}
                />
              </div>
            ) : null}
          </section>
        </>
      )}

      {ask ? (
        <div className={styles.askBackdrop} onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="ask-h" className={styles.ask}>
            <div className={shared.row} style={{ gap: 12, flexWrap: "nowrap" }}>
              <span className={styles.askIcon} aria-hidden="true">
                !
              </span>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <h2 id="ask-h" style={{ fontSize: 18, fontWeight: 700 }}>
                  Previous month in range
                </h2>
                <span className={shared.note} style={{ fontSize: 13 }}>
                  Payment report · {branchScope.label}
                  {data?.department ? ` · ${data.department.name}` : ""} · {ask.ext.toUpperCase()}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "#3e4a52" }}>
              Your date range ({rangeText}) includes a previous month — the current month starts {monthStartBs} ({monthLabel(currentMonth())}). Do you want to download the{" "}
              {ask.ext === "pdf" ? "PDF" : "sheet"} for {rangeText}?
            </p>
            <div className={shared.toggle}>
              <button type="button" className={shared.cancelBig} onClick={() => download(ask.ext, rangeFor("this_month"))}>
                Use this month instead
              </button>
              <button type="button" className={shared.primaryBig} onClick={() => download(ask.ext, range)}>
                Yes, download this range
              </button>
            </div>
            <button type="button" className={styles.askCancel} onClick={() => setAsk(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <VoidPaymentDialog
        payment={voiding?.payment ?? null}
        employeeName={voiding?.name}
        onClose={() => setVoiding(null)}
        onVoided={(p) => setToast(`${p.receipt_no} voided — it no longer counts as paid`)}
      />

      {toast ? (
        <div role="status" className={styles.toastDark}>
          <span style={{ color: "#7fd1c3", fontWeight: 700 }}>✓</span>
          {toast}
          <button type="button" aria-label="Dismiss" className={styles.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
