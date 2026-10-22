/**
 * Attendance dashboard widgets, keyed by the API's widget `kind`.
 *
 * SHARED CHANGE NEEDED on main (web/components/widgets/index.tsx):
 *
 *   import { ATTENDANCE_WIDGETS } from "@/components/attendance/widgets";
 *   const WIDGETS: Record<string, WidgetComponent> = {
 *     coming_soon: ComingSoonWidget,
 *     ...ATTENDANCE_WIDGETS,
 *   };
 *
 * (Do not import a side-effect "register" file from there: it would import
 * registerWidget back from the same module before WIDGETS is initialised.)
 */

import { AttendanceStatWidget } from "./AttendanceStatWidget";
import { AttendanceTodayWidget } from "./AttendanceTodayWidget";

export { AttendanceStatWidget, AttendanceTodayWidget };

export const ATTENDANCE_WIDGETS = {
  attendance_stat: AttendanceStatWidget,
  attendance_today: AttendanceTodayWidget,
} as const;
