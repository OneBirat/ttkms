"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { useSession } from "@/lib/session";
import { ManageDepartmentsDialog } from "../ManageDepartmentsDialog";
import { PhoneFrame } from "./PhoneFrame";
import { TodayPill } from "../TodayPill";
import { listDepartments, listEmployeeRows } from "../../api";
import { formatAmount, initials, matchesEmployee, thumbUrl } from "../../_lib/helpers";
import { useReportBranch } from "../../_lib/useBranchScope";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";

export const AVATAR_TONES = ["#6e5a4b", "#4f6d7a", "#7a5c61", "#5b7553", "#7a6a4f"];

export function avatarTone(id: number): string {
  return AVATAR_TONES[id % AVATAR_TONES.length];
}

/** Phone: staff list grouped by department (design PayrollMobile, list screen). No Add employee here. */
export function PhoneEmployees() {
  const router = useRouter();
  const searchId = useId();
  const departments = usePayroll(listDepartments, []);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<number | "all">("all");
  const [manageOpen, setManageOpen] = useState(false);
  const canManage = useSession().can("manage_employees");
  const branchScope = useReportBranch();
  const rows = usePayroll(() => listEmployeeRows(), []);
  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const shown = useMemo(
    () => all.filter((r) => (dept === "all" || r.employee.department?.id === dept) && matchesEmployee(r.employee, query)).sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name)),
    [all, dept, query],
  );
  const groups = (departments.data ?? [])
    .map((d) => ({ department: d, rows: shown.filter((r) => r.employee.department?.id === d.id) }))
    .filter((g) => g.rows.length > 0);
  const present = all.filter((r) => r.today === "present" || r.today === "overtime").length;
  const notMarked = all.filter((r) => r.today === "not_marked").length;
  const branchName = branchScope.label;

  return (
    <PhoneFrame
      title="Employees"
      subtitle={`${branchName} · ${all.length} staff`}
      branch
      headerExtra={
        <div className={styles.headerTiles}>
          <div className={styles.headerTile}>
            <span className={styles.headerTileLabel}>Staff</span>
            <span className={styles.headerTileValue}>{all.length}</span>
          </div>
          <div className={styles.headerTile}>
            <span className={styles.headerTileLabel}>Present today</span>
            <span className={styles.headerTileValue} style={{ color: "#7fd1c3" }}>
              {present}/{all.length}
            </span>
          </div>
          <div className={styles.headerTile}>
            <span className={styles.headerTileLabel}>Not marked</span>
            <span className={styles.headerTileValue} style={{ color: "#ffb4a3" }}>
              {notMarked}
            </span>
          </div>
        </div>
      }
    >
      <div className={styles.pad}>
        <div className={styles.field}>
          <Icon name="search" size={18} style={{ color: "var(--color-muted)" }} />
          <input id={searchId} type="search" aria-label="Search staff" placeholder="Search name or ID" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className={styles.chips} role="group" aria-label="Department">
        <button type="button" className={styles.chip} aria-pressed={dept === "all"} onClick={() => setDept("all")}>
          All <b>{all.length}</b>
        </button>
        {(departments.data ?? []).map((d) => (
          <button key={d.id} type="button" className={styles.chip} aria-pressed={dept === d.id} onClick={() => setDept(d.id)}>
            {d.name} <b>{all.filter((r) => r.employee.department?.id === d.id).length}</b>
          </button>
        ))}
        {canManage ? (
          <button type="button" className={styles.chip} onClick={() => setManageOpen(true)} aria-label="Manage departments">
            <Icon name="edit" size={14} /> Manage
          </button>
        ) : null}
      </div>
      <ManageDepartmentsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => {
          departments.reload();
          rows.reload();
          if (dept !== "all" && !(departments.data ?? []).some((d) => d.id === dept)) setDept("all");
        }}
      />
      {rows.error ? <p className={styles.empty}>{payrollErrorMessage(rows.error)}</p> : null}
      {!rows.data && !rows.error ? <p className={styles.empty}>Loading…</p> : null}
      {groups.map((g) => (
        <div key={g.department.id}>
          <div className={styles.groupHead}>
            <span>
              <span className={styles.groupTitle}>{g.department.name}</span> <span className={styles.groupSub}>· {g.rows.length} staff</span>
            </span>
          </div>
          <div className={styles.card} style={{ marginTop: 6 }}>
            {g.rows.map((r) => {
              const e = r.employee;
              return (
                <button key={e.id} type="button" className={styles.row} onClick={() => router.push(`/people/employees/${e.id}`)}>
                  <span className={styles.avatarTone} style={{ background: avatarTone(e.id) }}>
                    {e.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data: URLs from the capture flow
                      <img src={thumbUrl(e) ?? ""} alt="" />
                    ) : (
                      initials(e.full_name)
                    )}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{e.full_name}</span>
                    <span className={styles.rowSub}>
                      {e.code} · {e.designation ?? "—"}
                    </span>
                  </span>
                  <span className={styles.rowRight}>
                    <TodayPill status={r.today} small />
                    {r.balance_due !== null ? (
                      <span className={r.balance_due > 0 ? styles.due : styles.nothingDue}>{r.balance_due > 0 ? `due Rs ${formatAmount(r.balance_due)}` : "nothing due"}</span>
                    ) : null}
                  </span>
                  <span className={styles.rowChevron} aria-hidden="true">
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {rows.data && shown.length === 0 ? <p className={styles.empty}>No staff match. Try another department or clear the search.</p> : null}
    </PhoneFrame>
  );
}
