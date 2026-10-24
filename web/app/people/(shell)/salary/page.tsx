import type { Metadata } from "next";
import { Suspense } from "react";
import { SalaryReportScreen } from "@/app/people/_components/SalaryReportScreen";

export const metadata: Metadata = { title: "Salary report" };

export default function SalaryReportPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SalaryReportScreen />
    </Suspense>
  );
}
