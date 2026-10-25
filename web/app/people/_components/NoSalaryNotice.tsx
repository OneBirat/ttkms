"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

/** The 404 ``code`` payroll answers for a month without a salary row (vs "before_joining"). */
export const NO_SALARY = "no_salary";

/** Whether an API error is "No salary set up yet" (payroll's 404 code ``no_salary``). */
export function isNoSalary(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === NO_SALARY;
}

export interface NoSalaryNoticeProps {
  employeeId: number;
  className?: string;
  /** Rendered before the button (the error box style of the screen it sits in). */
  message?: string;
}

/**
 * "No salary set up yet — add it in the Salary tab", with a button to that tab for users who may
 * edit employees (manage_employees). The joining-date text stays for months before joined_ad.
 */
export function NoSalaryNotice({ employeeId, className, message = "No salary set up yet — add it in the Salary tab." }: NoSalaryNoticeProps) {
  const { can } = useSession();
  return (
    <p role="alert" className={className} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span>{message}</span>
      {can("manage_employees") ? (
        <Link href={`/people/employees/${employeeId}`} className="btn btn--sm">
          Open Salary tab
        </Link>
      ) : null}
    </p>
  );
}
