"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { PhoneFrame } from "./PhoneFrame";
import { useReportBranch } from "../../_lib/useBranchScope";
import { listDepartments, listPayments } from "../../api";
import { listBranches } from "../../api";
import { formatBsDay } from "@/lib/bs";
import { rangeFor, today } from "../../_lib/months";
import { formatAmount, groupBy, initials } from "../../_lib/helpers";
import { REGISTER_SORTS, groupRowsByDepartment, isRegisterSort } from "../../_lib/register";
import type { RegisterRow, RegisterSort, RegisterTypeFilter } from "../../types";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";

const CHIPS: { value: RegisterTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "advance", label: "Advances" },
  { value: "salary", label: "Salary" },
];

const SORT_HINT: Record<RegisterSort, string> = {
  date: "Newest first, grouped by day",
  department: "A–Z, grouped with a subtotal each",
  employee: "Name A–Z",
  amount: "Highest first",
};

/**
 * Phone: Payment reports grouped by day (design PayrollMobile, payments screen), with the same
 * department chips as the desktop (slider) and the sort in a small sheet; ?dept=&sort= live in
 * the URL. No tiles, no record form.
 */
export function PhonePayments() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const branches = usePayroll(listBranches, []);
  const departments = usePayroll(listDepartments, []);
  const [type, setType] = useState<RegisterTypeFilter>("all");
  const [sortOpen, setSortOpen] = useState(false);
  const deptParam = Number(params.get("dept") ?? "0");
  const departmentId: number | null = Number.isInteger(deptParam) && deptParam > 0 ? deptParam : null;
  const sort: RegisterSort = isRegisterSort(params.get("sort")) ? (params.get("sort") as RegisterSort) : "date";
  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const range = useMemo(() => rangeFor("last_3"), []);
  const branchScope = useReportBranch(branches.data ?? []);
  const register = usePayroll(
    () => listPayments({ ...range, type, branch_id: branchScope.branchId, department_id: departmentId, sort }),
    [type, branchScope.branchId, departmentId, sort],
  );
  const picker = branchScope.picker;
  const data = register.data;
  const rows = data?.rows ?? [];
  const t = today().bs;
  const dayLabel = (bs: string) => {
    const np = formatBsDay(bs, "ne");
    if (bs === t) return `Today · ${np}`;
    return `${np}${bs.slice(0, 4) !== t.slice(0, 4) ? `, ${bs.slice(0, 4)}` : ""}`;
  };
  const countOf = (id: number | null) => data?.by_department.find((d) => (d.department?.id ?? null) === id)?.count ?? 0;
  const allCount = data?.by_department.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const sortLabel = REGISTER_SORTS.find((s) => s.value === sort)?.label ?? "Date";
  const sum = (list: RegisterRow[]) => list.reduce((s, r) => s + r.payment.amount, 0);

  const payRow = ({ payment: p, employee: e }: RegisterRow) => (
    <div key={p.id} className={styles.payRow}>
      <span className={styles.payAvatar} data-type={p.type}>
        {initials(e.full_name)}
      </span>
      <span className={styles.txText}>
        <span className={styles.txLine}>
          <span className={styles.rowName}>{e.full_name}</span>
          <span className={styles.txAmount} style={{ color: p.type === "advance" ? "var(--pill-leave-fg)" : "var(--pill-ok-fg)" }}>
            Rs {formatAmount(p.amount)}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span className={styles.pill} data-tone={p.type === "advance" ? "advance" : "ok"}>
            {p.type === "advance" ? "Advance" : "Salary"}
          </span>
          <span className={styles.rowSub} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {sort === "date" ? "" : `${p.date.bs} · `}
            {p.payment_mode.name} · {p.receipt_no}
          </span>
        </span>
        <span className={styles.txBalance}>
          {e.department?.name ?? "No department"} · recorded by {p.recorded_by}
        </span>
      </span>
    </div>
  );

  // Date: one card per day. Department: one card per department with a subtotal. Employee / Amount: one flat card.
  const sections =
    sort === "date"
      ? groupBy(rows, (r) => r.payment.date.bs).map((d) => ({
          key: d.key,
          title: dayLabel(d.key),
          lang: "ne" as const,
          rows: d.items,
          subtotal: null as null | { salary: number; advances: number; total: number },
        }))
      : sort === "department"
        ? groupRowsByDepartment(rows).map((g) => ({
            key: `d-${g.department?.id ?? "none"}`,
            title: `${g.department?.name ?? "No department"} · ${g.rows.length}`,
            lang: undefined,
            rows: g.rows,
            subtotal: { salary: g.salary, advances: g.advances, total: g.total },
          }))
        : rows.length
          ? [{ key: "all", title: sort === "employee" ? "By employee, A–Z" : "By amount, highest first", lang: undefined, rows, subtotal: null }]
          : [];

  return (
    <PhoneFrame
      title="Payment reports"
      subtitle={`${branchScope.label}${data?.department ? ` · ${data.department.name}` : ""} · advances & salary paid`}
      branch={picker}
    >
      <div className={styles.chips} role="group" aria-label="Type">
        {CHIPS.map((c) => (
          <button key={c.value} type="button" className={styles.chip} aria-pressed={type === c.value} onClick={() => setType(c.value)}>
            {c.label}
          </button>
        ))}
        <button type="button" className={styles.chip} onClick={() => setSortOpen(true)} aria-haspopup="dialog" aria-label={`Sort: ${sortLabel}`}>
          Sort · {sortLabel} ▾
        </button>
      </div>
      <div className={styles.chips} role="group" aria-label="Department">
        <button type="button" className={styles.chip} aria-pressed={departmentId === null} onClick={() => setParams({ dept: null })}>
          All <b>{allCount}</b>
        </button>
        {(departments.data ?? []).map((d) => (
          <button key={d.id} type="button" className={styles.chip} aria-pressed={departmentId === d.id} onClick={() => setParams({ dept: String(d.id) })}>
            {d.name} <b>{countOf(d.id)}</b>
          </button>
        ))}
      </div>
      {register.error ? <p className={styles.empty}>{payrollErrorMessage(register.error)}</p> : null}
      {!data && !register.error ? <p className={styles.empty}>Loading…</p> : null}
      {sections.map((section) => (
        <div key={section.key}>
          <div className={styles.dayHead}>
            <span className={styles.groupTitle} lang={section.lang}>
              {section.title}
            </span>
            <span className="mono" style={{ color: "var(--color-muted)" }}>
              Rs {formatAmount(sum(section.rows))}
            </span>
          </div>
          <div className={styles.card} style={{ marginTop: 6 }}>
            {section.rows.map(payRow)}
            {section.subtotal ? (
              <div className={styles.kvLine} style={{ padding: "10px 14px", fontSize: 13 }} role="note">
                <span>
                  Salary {formatAmount(section.subtotal.salary)} · Advances {formatAmount(section.subtotal.advances)}
                </span>
                <b className="mono">Rs {formatAmount(section.subtotal.total)}</b>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {data && rows.length > 0 ? (
        <div className={styles.kvTotal} style={{ margin: "12px 16px 0" }}>
          <span>
            Total · {rows.length} payment{rows.length === 1 ? "" : "s"}
            {data.department ? ` · ${data.department.name}` : ""}
          </span>
          <b className="mono">Rs {formatAmount(sum(rows))}</b>
        </div>
      ) : null}
      {data && rows.length === 0 ? <p className={styles.empty}>No payments in the last three months{data.department ? ` for ${data.department.name}` : ""}.</p> : null}

      <BottomSheet open={sortOpen} label="Sort payments" onClose={() => setSortOpen(false)}>
        <div className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>Sort by</h2>
        </div>
        {REGISTER_SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={styles.sheetAction}
            aria-pressed={sort === s.value}
            data-tone={sort === s.value ? "ok" : undefined}
            onClick={() => {
              setParams({ sort: s.value === "date" ? null : s.value });
              setSortOpen(false);
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: 1 }}>
              <span>{s.label}</span>
              <span className={styles.rowSub}>{SORT_HINT[s.value]}</span>
            </span>
            {sort === s.value ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
        <button type="button" className={styles.sheetCancel} onClick={() => setSortOpen(false)}>
          Cancel
        </button>
      </BottomSheet>
    </PhoneFrame>
  );
}
