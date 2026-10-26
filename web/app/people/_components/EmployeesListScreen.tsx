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
import { ManageDepartmentsDialog } from "./ManageDepartmentsDialog";
import { TodayPill } from "./TodayPill";
import { listDepartments, listEmployeeRows } from "../api";
import { formatAmount, formatRs, matchesEmployee, thumbUrl } from "../_lib/helpers";
import type { EmployeeListRow } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import { useReportBranch } from "../_lib/useBranchScope";
import { withBranch } from "@/lib/branchContext";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

const DEPT_TONES = ["ok", "ot", "advance", "purple", "neutral"] as const;

/** /people/employees: every employee of one branch with today's mark and the balance due. */
export function EmployeesListScreen() {
  const router = useRouter();
  const searchId = useId();
  const departments = usePayroll(listDepartments, []);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<number | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const { can } = useSession();
  const canManage = can("manage_employees");
  const canMoney = can("salary_advances");

  // The ONE active branch (switched in the shell; the server scopes the list to it).
  const branchScope = useReportBranch();
  const rows = usePayroll(() => listEmployeeRows(), []);
  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const filtered = useMemo(
    () => all.filter((r) => (department === "all" || r.employee.department?.id === department) && matchesEmployee(r.employee, query)),
    [all, department, query],
  );
  const deptCounts = (departments.data ?? []).map((d) => ({ department: d, count: all.filter((r) => r.employee.department?.id === d.id).length }));
  const presentToday = all.filter((r) => r.today === "present" || r.today === "overtime").length;
  const notMarked = all.filter((r) => r.today === "not_marked").length;
  const branchName = branchScope.label;
  const toneOf = (id: number | undefined) => DEPT_TONES[((id ?? 0) - 1 + DEPT_TONES.length) % DEPT_TONES.length];

  const open = (row: EmployeeListRow) => (event: MouseEvent) => {
    event.preventDefault();
    router.push(`/people/employees/${row.employee.id}`);
  };

  return (
    <>
      <PageHeader
        title={withBranch("Employees", { name: branchScope.label })}
        subtitle="All employees with their department. Click a row to open their account."
        actions={
          <div className={shared.row}>
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
              {canManage ? (
                <button type="button" className={`btn ${styles.deptManage}`} onClick={() => setManageOpen(true)}>
                  <Icon name="edit" size={16} />
                  Manage departments
                </button>
              ) : null}
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
                    {canMoney ? (
                      <th scope="col" className={shared.num}>
                        Monthly salary
                      </th>
                    ) : null}
                    <th scope="col" style={{ textAlign: "center" }}>
                      Today
                    </th>
                    {canMoney ? (
                      <th scope="col" className={shared.num}>
                        Balance due
                      </th>
                    ) : null}
                    <th scope="col">
                      <span className={shared.srOnly}>Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={canMoney ? 9 : 7} className={shared.empty}>
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
                              <Avatar name={e.full_name} photoUrl={thumbUrl(e)} size={34} />
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
                          {canMoney ? (
                            <td className={shared.num}>
                              {row.rate ? (row.pay_type === "monthly" ? formatRs(row.rate) : `${formatRs(row.rate)} / day`) : "—"}
                            </td>
                          ) : null}
                          <td style={{ textAlign: "center" }}>
                            <TodayPill status={row.today} />
                          </td>
                          {canMoney ? (
                            <td className={`${shared.num} ${(row.balance_due ?? 0) > 0 ? styles.dueCell : shared.muted}`}>
                              {(row.balance_due ?? 0) > 0 ? `Rs ${formatAmount(row.balance_due ?? 0)}` : "—"}
                            </td>
                          ) : null}
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

      <ManageDepartmentsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => {
          departments.reload();
          rows.reload();
          if (department !== "all" && !(departments.data ?? []).some((d) => d.id === department)) setDepartment("all");
        }}
      />
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
