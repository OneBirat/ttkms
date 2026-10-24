/**
 * Attendance dashboard widgets, keyed by the API's widget `kind`. The shared
 * map in web/components/widgets/index.tsx spreads ATTENDANCE_WIDGETS into its
 * registry (a side-effect "register" import would hit a circular import).
 */

import { AttendanceTodayWidget } from "./AttendanceTodayWidget";

export { AttendanceTodayWidget };

export const ATTENDANCE_WIDGETS = {
  attendance_today: AttendanceTodayWidget,
} as const;
