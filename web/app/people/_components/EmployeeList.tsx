"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
import { Icon } from "@/components/icons";
import { Avatar } from "./Avatar";
import { departmentCounts, groupByDepartment, matchesEmployee } from "../_lib/helpers";
import type { Department, Employee, EmployeeSort } from "../types";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface EmployeeListProps {
  employees: Employee[];
  departments: Department[];
  selectedId: number | null;
  /** The open employee's department: listed first with a dark header. */
  ownDepartmentId?: number | null;
  query: string;
  onQuery: (value: string) => void;
  department: number | "all";
  onDepartment: (value: number | "all") => void;
  sort: EmployeeSort;
  onSort: (value: EmployeeSort) => void;
}

const SORTS: { value: EmployeeSort; label: string }[] = [
  { value: "name", label: "Sort: Name A–Z" },
  { value: "code", label: "Sort: Employee ID" },
  { value: "designation", label: "Sort: Designation" },
];

/** Search + department dropdown + sort, employees grouped by department. */
export function EmployeeList({
  employees,
  departments,
  selectedId,
  ownDepartmentId = null,
  query,
  onQuery,
  department,
  onDepartment,
  sort,
  onSort,
}: EmployeeListProps) {
  const searchId = useId();
  const deptId = useId();
  const sortId = useId();
  const counts = useMemo(() => departmentCounts(employees, departments), [employees, departments]);
  const filtered = useMemo(
    () =>
      employees.filter(
        (e) => (department === "all" || e.department?.id === department) && matchesEmployee(e, query),
      ),
    [employees, department, query],
  );
  const groups = useMemo(() => {
    const all = groupByDepartment(filtered, departments, sort);
    if (ownDepartmentId === null) return all;
    const own = all.filter((g) => g.department?.id === ownDepartmentId);
    return [...own, ...all.filter((g) => g.department?.id !== ownDepartmentId)];
  }, [filtered, departments, sort, ownDepartmentId]);
  const deptName = department === "all" ? "All departments" : departments.find((d) => d.id === department)?.name ?? "Department";

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
      <div className={styles.listControls}>
        <label htmlFor={deptId} className={shared.srOnly}>
          Department
        </label>
        <div className={`field ${shared.selectWrap}`}>
          <select
            id={deptId}
            value={department === "all" ? "all" : String(department)}
            onChange={(event) => onDepartment(event.target.value === "all" ? "all" : Number(event.target.value))}
          >
            <option value="all">All ({employees.length})</option>
            {counts.map(({ department: d, count }) => (
              <option key={d.id} value={d.id}>
                {d.name} ({count})
              </option>
            ))}
          </select>
        </div>
        <label htmlFor={sortId} className={shared.srOnly}>
          Sort
        </label>
        <div className={`field ${shared.selectWrap}`}>
          <select id={sortId} value={sort} onChange={(event) => onSort(event.target.value as EmployeeSort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.listScroll} role="list">
        {groups.length === 0 ? <p className={styles.listFooter}>No employee matches.</p> : null}
        {groups.map((group) => (
          <div key={group.department?.id ?? "none"} role="presentation">
            {group.department && group.department.id === ownDepartmentId ? (
              <span className={styles.groupOwn}>
                <span>
                  {group.department.name} · {group.employees.length} · this employee
                </span>
              </span>
            ) : (
              <span className={styles.group}>
                <span>{group.department?.name ?? "No department"}</span>
                <span className={styles.groupCount}>{group.employees.length}</span>
              </span>
            )}
            {group.employees.map((employee) => {
              const selected = employee.id === selectedId;
              return (
                <Link
                  key={employee.id}
                  role="listitem"
                  href={`/people/employees/${employee.id}`}
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
                    <span className={styles.empName}>
                      {employee.full_name}
                      {!employee.active ? <span className={styles.inactive}> · inactive</span> : null}
                    </span>
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
        Showing {filtered.length} of {employees.length} · {deptName}
      </span>
    </aside>
  );
}
