import type { Metadata } from "next";
import { Suspense } from "react";
import { EmployeesListScreen } from "@/app/people/_components/EmployeesListScreen";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <EmployeesListScreen />
    </Suspense>
  );
}
