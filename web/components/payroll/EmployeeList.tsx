"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import { departmentCounts, groupByDepartment, matchesEmployee } from "./helpers";
import type { Department, EmployeeProfile } from "./types";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface EmployeeListProps {
  employees: EmployeeProfile[];
  departments: Department[];
  selectedId: number | null;
  query: string;
  onQuery: (value: string) => void;
  department: number | "all";
  onDepartment: (value: number | "all") => void;
}

/** Search + department filter + employees grouped by department. */
export function EmployeeList({
  employees,
  departments,
  selectedId,
  query,
  onQuery,
  department,
  onDepartment,
}: EmployeeListProps) {
  const searchId = useId();
  const deptId = useId();
  const counts = useMemo(() => departmentCounts(employees, departments), [employees, departments]);
  const filtered = useMemo(
    () =>
      employees.filter(
        (e) =>
          (department === "all" || e.department?.id === department) && matchesEmployee(e, query),
      ),
    [employees, department, query],
  );
  const groups = useMemo(() => groupByDepartment(filtered, departments), [filtered, departments]);

  return (
    <aside aria-label="Employee list" className={`card ${styles.list}`}>
      <label htmlFor={searchId} className={shared.srOnly}>
        Search employees
      </label>
      <div className="field">
        <Icon name="search" size={16} style={{ color: "var(--color-muted)" }} />
        <input
          id={searchId}
          type="search"
          placeholder="Search name or ID"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          autoComplete="off"
        />
      </div>
      <label htmlFor={deptId} className={shared.srOnly}>
        Department
      </label>
      <div className={`field ${shared.selectWrap}`}>
        <select
          id={deptId}
          value={department === "all" ? "all" : String(department)}
          onChange={(event) =>
            onDepartment(event.target.value === "all" ? "all" : Number(event.target.value))
          }
        >
          <option value="all">All departments ({employees.length})</option>
          {counts.map(({ department: d, count }) => (
            <option key={d.id} value={d.id}>
              {d.name} ({count})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.listScroll} role="list">
        {groups.length === 0 ? (
          <p className={styles.listFooter}>No employee matches.</p>
        ) : null}
        {groups.map((group) => (
          <div key={group.department?.id ?? "none"} role="presentation">
            <span className={styles.group} style={{ display: "block" }}>
              {group.department?.name ?? "No department"}
            </span>
            {group.employees.map((employee) => {
              const selected = employee.id === selectedId;
              return (
                <Link
                  key={employee.id}
                  role="listitem"
                  href={`/payroll/employees/${employee.id}`}
                  className={styles.emp}
                  aria-current={selected ? "true" : undefined}
                >
                  <Avatar
                    name={employee.full_name}
                    photoUrl={employee.photo_url}
                    size={34}
                    tone={selected ? "selected" : "default"}
                  />
                  <span className={styles.empText}>
                    <span className={styles.empName}>{employee.full_name}</span>
                    <span className={styles.empSub}>
                      {employee.code} · {employee.designation ?? "—"}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <span className={styles.listFooter}>
        Showing {filtered.length} of {employees.length}
        {filtered.length > 8 ? " · scroll for more" : ""}
      </span>
    </aside>
  );
}
