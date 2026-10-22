import type { Metadata } from "next";
import { ReportPage } from "@/components/attendance/ReportPage";

export const metadata: Metadata = { title: "Attendance report" };

export default function AttendanceReportRoute() {
  return <ReportPage />;
}
