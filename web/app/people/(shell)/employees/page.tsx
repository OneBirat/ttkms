import type { Metadata } from "next";
import { Suspense } from "react";
import { EmployeesListScreen } from "@/app/people/_components/EmployeesListScreen";
import { Responsive } from "@/app/people/_components/Responsive";
import { PhoneEmployees } from "@/app/people/_components/phone/PhoneEmployees";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Responsive phone={<PhoneEmployees />} desktop={<EmployeesListScreen />} />
    </Suspense>
  );
}
