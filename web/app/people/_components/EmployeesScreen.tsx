"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { AddEmployeeDialog } from "./AddEmployeeDialog";
import { EmployeeAccount } from "./EmployeeAccount";
import { EmployeeList } from "./EmployeeList";
import { listDepartments, listEmployees } from "../api";
import type { EmployeeSort } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./employees.module.css";

export interface EmployeesScreenProps {
  /** From /people/employees/[id]; null on /people/employees (first employee is shown). */
  selectedId: number | null;
}

export function EmployeesScreen({ selectedId }: EmployeesScreenProps) {
  const router = useRouter();
  const employees = usePayroll(listEmployees, []);
  const departments = usePayroll(listDepartments, []);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<number | "all">("all");
  const [sort, setSort] = useState<EmployeeSort>("name");
  const [addOpen, setAddOpen] = useState(false);

  const list = employees.data ?? [];
  const selected =
    selectedId !== null && list.some((e) => e.id === selectedId)
      ? selectedId
      : selectedId === null
        ? (list[0]?.id ?? null)
        : null;

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Each employee has one account: profile, barcode, salary structure, monthly ledger and payments."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={16} />
            Add employee
          </button>
        }
      />

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
            employees={list}
            departments={departments.data ?? []}
            selectedId={selected}
            query={query}
            onQuery={setQuery}
            department={department}
            onDepartment={setDepartment}
            sort={sort}
            onSort={setSort}
          />
          <div className={styles.detail}>
            {selected !== null ? (
              <EmployeeAccount id={selected} />
            ) : selectedId !== null ? (
              <EmptyState icon="alert" title="Employee not found" text="This employee does not exist or was removed." />
            ) : (
              <EmptyState icon="users" title="No employees yet" text="Add the first employee to get started.">
                <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
                  Add employee
                </button>
              </EmptyState>
            )}
          </div>
        </div>
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
