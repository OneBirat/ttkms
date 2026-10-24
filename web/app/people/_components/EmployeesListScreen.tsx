"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type MouseEvent } from "react";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useSession } from "@/lib/session";
import { AddEmployeeDialog } from "./AddEmployeeDialog";
import { Avatar } from "./Avatar";
import { TodayPill } from "./TodayPill";
import { listBranches, listDepartments, listEmployeeRows } from "../api";
import { formatAmount, formatRs, matchesEmployee } from "../_lib/helpers";
import type { EmployeeListRow } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

const DEPT_TONES = ["ok", "ot", "advance", "purple", "neutral"] as const;

/** /people/employees: every employee of one branch with today's mark and the balance due. */
export function EmployeesListScreen() {
  const router = useRouter();
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const searchId = useId();
  const branchId = useId();
  const branches = usePayroll(listBranches, []);
  const departments = usePayroll(listDepartments, []);
  const [branch, setBranch] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<number | "all">("all");
  const [addOpen, setAddOpen] = useState(false);

  // Admins switch branches; everyone else sees their own (the first one until
  // the session carries a branch — NEEDS FROM MAIN: user.branch_id).
  const branchList = branches.data ?? [];
  const activeBranch = branch ?? branchList[0]?.id ?? null;
  const rows = usePayroll(() => listEmployeeRows(activeBranch), [activeBranch]);
  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const filtered = useMemo(
    () => all.filter((r) => (department === "all" || r.employee.department?.id === department) && matchesEmployee(r.employee, query)),
    [all, department, query],
  );
  const deptCounts = (departments.data ?? []).map((d) => ({ department: d, count: all.filter((r) => r.employee.department?.id === d.id).length }));
  const presentToday = all.filter((r) => r.today === "present" || r.today === "overtime").length;
  const notMarked = all.filter((r) => r.today === "not_marked").length;
  const branchName = branchList.find((b) => b.id === activeBranch)?.name ?? "";
  const toneOf = (id: number | undefined) => DEPT_TONES[((id ?? 0) - 1 + DEPT_TONES.length) % DEPT_TONES.length];

  const open = (row: EmployeeListRow) => (event: MouseEvent) => {
    event.preventDefault();
    router.push(`/people/employees/${row.employee.id}`);
  };

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="All employees with their department. Click a row to open their account."
        actions={
          <div className={shared.row}>
            {isAdmin ? (
              <label htmlFor={branchId} className={styles.branchLabel}>
                Branch
                <span className={`field ${shared.selectWrap} ${styles.branchField}`}>
                  <Icon name="home" size={16} style={{ color: "var(--color-primary)" }} />
                  <select id={branchId} value={activeBranch ?? ""} onChange={(e) => setBranch(Number(e.target.value))}>
                    {branchList.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : (
              <span className={styles.branchLock}>🔒 {branchName || "Your branch"} · your branch</span>
            )}
            <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={16} />
              Add employee
            </button>
          </div>
        }
      />

      {rows.error ? (
        <EmptyState icon="alert" title="Could not load employees" text={payrollErrorMessage(rows.error)}>
          <button type="button" className="btn" onClick={rows.reload}>
            Try again
          </button>
        </EmptyState>
      ) : !rows.data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <section aria-label="All employees" className={shared.stack} style={{ gap: 14 }}>
          <div className={styles.tiles4}>
            <div className={`card ${styles.listTile}`}>
              <span className={styles.listTileLabel}>Employees · {branchName}</span>
              <span className={styles.listTileValue}>{all.length}</span>
            </div>
            <div className={`card ${styles.listTile}`}>
              <span className={styles.listTileLabel}>Departments</span>
              <span className={styles.listTileValue}>{deptCounts.filter((d) => d.count > 0).length}</span>
            </div>
            <div className={`card ${styles.listTile}`}>
              <span className={styles.listTileLabel}>Present today</span>
              <span className={`${styles.listTileValue} ${shared.ok}`}>
                {presentToday} / {all.length}
              </span>
            </div>
            <div className={`card ${styles.listTile}`}>
              <span className={styles.listTileLabel}>Not marked today</span>
              <span className={`${styles.listTileValue} ${shared.danger}`}>{notMarked}</span>
            </div>
          </div>

          <div className={`card ${styles.listCard}`}>
            <div className={shared.row}>
              <label htmlFor={searchId} className={shared.srOnly}>
                Search employees
              </label>
              <div className={`field ${styles.listSearch}`}>
                <Icon name="search" size={16} style={{ color: "var(--color-muted)" }} />
                <input id={searchId} type="search" placeholder="Search name or ID" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              </div>
              <div role="group" aria-label="Department" className={styles.deptChips}>
                <button type="button" className={styles.deptChip} aria-pressed={department === "all"} onClick={() => setDepartment("all")}>
                  All <b>{all.length}</b>
                </button>
                {deptCounts.map(({ department: d, count }) => (
                  <button key={d.id} type="button" className={styles.deptChip} aria-pressed={department === d.id} onClick={() => setDepartment(d.id)}>
                    {d.name} <b>{count}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className={shared.tableWrap}>
              <table className={shared.table}>
                <caption className={shared.srOnly}>Employees of {branchName}</caption>
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Department</th>
                    <th scope="col">Designation</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Joined (BS)</th>
                    <th scope="col" className={shared.num}>
                      Monthly salary
                    </th>
                    <th scope="col" style={{ textAlign: "center" }}>
                      Today
                    </th>
                    <th scope="col" className={shared.num}>
                      Balance due
                    </th>
                    <th scope="col">
                      <span className={shared.srOnly}>Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={shared.empty}>
                        No employees match.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row) => {
                      const e = row.employee;
                      return (
                        <tr key={e.id} className={styles.erow} onClick={open(row)}>
                          <td>
                            <span className={styles.erowEmp}>
                              <Avatar name={e.full_name} photoUrl={e.photo_url} size={34} />
                              <span className={styles.empText}>
                                <Link href={`/people/employees/${e.id}`} className={styles.elink} onClick={open(row)}>
                                  {e.full_name}
                                </Link>
                                <span className={`${styles.empSub} mono`}>{e.code}</span>
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className={styles.deptTag} data-tone={toneOf(e.department?.id)}>
                              {e.department?.name ?? "—"}
                            </span>
                          </td>
                          <td style={{ color: "#3e4a52" }}>{e.designation ?? "—"}</td>
                          <td className="mono" style={{ fontSize: 13, color: "#3e4a52" }}>
                            {e.phone ?? "—"}
                          </td>
                          <td className="mono" style={{ fontSize: 13 }}>
                            {e.joined.bs}
                          </td>
                          <td className={shared.num}>
                            {row.rate ? (row.pay_type === "monthly" ? formatRs(row.rate) : `${formatRs(row.rate)} / day`) : "—"}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <TodayPill status={row.today} />
                          </td>
                          <td className={`${shared.num} ${row.balance_due > 0 ? styles.dueCell : shared.muted}`}>
                            {row.balance_due > 0 ? `Rs ${formatAmount(row.balance_due)}` : "—"}
                          </td>
                          <td className={styles.chevCell}>›</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <span className={styles.listFooter}>
              Showing {filtered.length} of {all.length} in {branchName}
              {department !== "all" ? ` · ${deptCounts.find((d) => d.department.id === department)?.department.name ?? ""}` : ""} · click a row to open the
              employee&apos;s account
            </span>
          </div>
        </section>
      )}

      <AddEmployeeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(employee) => {
          setAddOpen(false);
          router.push(`/people/employees/${employee.id}`);
        }}
      />
    </>
  );
}
