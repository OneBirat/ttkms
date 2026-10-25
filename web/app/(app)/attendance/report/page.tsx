import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportPage } from "@/components/attendance/ReportPage";

export const metadata: Metadata = { title: "Attendance report" };

export default function AttendanceReportRoute() {
  // useSearchParams() (?employee=&bs_year=&bs_month=) inside ReportPage needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ReportPage />
    </Suspense>
  );
}
