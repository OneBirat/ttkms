import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportScreen } from "@/components/attendance/ReportScreen";

export const metadata: Metadata = { title: "Attendance report" };

export default function AttendanceReportRoute() {
  // useSearchParams() (?employee=&bs_year=&bs_month=) inside the report screens needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ReportScreen />
    </Suspense>
  );
}
