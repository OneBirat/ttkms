/**
 * Registers the attendance dashboard widgets by `kind`.
 *
 * SHARED CHANGE NEEDED on main: web/components/widgets/index.tsx must import
 * this file once (`import "@/components/attendance/widgets/register";`) so the
 * registration runs before the dashboard renders. Until then the dashboard
 * shows "Unknown widget attendance_today".
 */

import { registerWidget } from "@/components/widgets";
import { AttendanceStatWidget } from "./AttendanceStatWidget";
import { AttendanceTodayWidget } from "./AttendanceTodayWidget";

registerWidget("attendance_stat", AttendanceStatWidget);
registerWidget("attendance_today", AttendanceTodayWidget);
