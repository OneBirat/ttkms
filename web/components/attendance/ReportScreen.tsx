"use client";

import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { ReportMobile } from "./ReportMobile";
import { ReportPage } from "./ReportPage";

/**
 * Attendance report (/attendance/report): the desktop ReportPage, and under 640px the phone
 * screen (design/report-mobile/AttendanceReportMobile.dc.html). Same endpoint and exports.
 */
export function ReportScreen() {
  const phone = useMediaQuery(PHONE_QUERY);
  return phone ? <ReportMobile /> : <ReportPage />;
}
