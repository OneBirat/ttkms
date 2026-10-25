"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ACCOUNT_TABS, EmployeeAccount, isAccountTab, type AccountTab } from "./EmployeeAccount";
import { EmployeeList } from "./EmployeeList";
import { listDepartments, listEmployees } from "../api";
import type { EmployeeSort } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import { branchStaff } from "../_lib/account";
import styles from "./employees.module.css";

/**
 * /people/employees/[id]: "‹ All employees", the left list (the staff of the employee's branch,
 * own department first; collapsible to an avatar strip) and the account. `?dept=` (id or name, e.g. from a
 * double-click on the attendance sheet) preselects the department filter;
 * `?tab=` picks the section.
 */
export function EmployeeAccountScreen({ id }: { id: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const employees = usePayroll(listEmployees, []);
  const departments = usePayroll(listDepartments, []);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<number | "all">("all");
  const [sort, setSort] = useState<EmployeeSort>("name");
  const [deptApplied, setDeptApplied] = useState<string | null>(null);

  const tabParam = params.get("tab");
  const tab: AccountTab = isAccountTab(tabParam) ? tabParam : "salary";
  const setTab = useCallback(
    (next: AccountTab) => {
      const search = new URLSearchParams(params.toString());
      if (next === "salary") search.delete("tab");
      else search.set("tab", next);
      const qs = search.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // ?dept= from attendance: a department id or name, applied once per value.
  const deptParam = params.get("dept");
  useEffect(() => {
    if (deptParam === null || deptParam === deptApplied || !departments.data) return;
    const match = departments.data.find((d) => String(d.id) === deptParam || d.name.toLowerCase() === deptParam.toLowerCase());
    setDepartment(match ? match.id : "all");
    setDeptApplied(deptParam);
  }, [deptParam, deptApplied, departments.data]);

  const list = employees.data ?? [];
  const person = list.find((e) => e.id === id) ?? null;
  const staff = person ? branchStaff(list, person.branch.id) : [];

  return (
    <>
      <PageHeader title="Employees" subtitle="Each employee has one account: profile, salary structure, monthly pay ledger and advances." />
      <Link href="/people/employees" className={styles.back}>
        <span aria-hidden="true" className={styles.backChevron}>
          ‹
        </span>
        All employees
      </Link>

      {employees.error ? (
        <EmptyState icon="alert" title="Could not load employees" text={payrollErrorMessage(employees.error)}>
          <button type="button" className="btn" onClick={employees.reload}>
            Try again
          </button>
        </EmptyState>
      ) : employees.loading && !employees.data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <div className={styles.layout}>
          <EmployeeList
            employees={staff}
            branchName={person?.branch.name ?? ""}
            departments={departments.data ?? []}
            selectedId={person?.id ?? null}
            ownDepartmentId={person?.department?.id ?? null}
            query={query}
            onQuery={setQuery}
            department={department}
            onDepartment={setDepartment}
            sort={sort}
            onSort={setSort}
          />
          <div className={styles.detail}>
            {person ? (
              <EmployeeAccount id={person.id} tab={tab} onTab={setTab} />
            ) : (
              <EmptyState icon="alert" title="Employee not found" text="This employee does not exist or was removed.">
                <Link href="/people/employees" className="btn">
                  All employees
                </Link>
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export { ACCOUNT_TABS };
