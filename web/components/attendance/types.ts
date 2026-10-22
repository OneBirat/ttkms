/**
 * Attendance module contract: the shapes `web/components/attendance/api.ts`
 * returns today from mock data and the FastAPI endpoints under
 * /api/attendance will return next session. Keep the two in sync.
 *
 * Dates: AD dates are the stored/primary key ("YYYY-MM-DD"); BS dates
 * ("YYYY-MM-DD", Bikram Sambat) are what the UI shows first. The API always
 * sends both so the browser never converts calendars itself.
 */

/** A marked status. "Not marked" is the absence of a record. */
export type AttendanceStatus =
  | "present"
  | "late"
  | "half_day"
  | "leave"
  | "absent";

/** What one grid cell can show. */
export type DayStatus = AttendanceStatus | "not_marked" | "weekly_off";

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  "present",
  "late",
  "half_day",
  "leave",
  "absent",
];

// ------------------------------------------------------------ core refs

/** Read-only view of core.employees joined with branch and department. */
export interface EmployeeRef {
  id: number;
  /** "E-001" */
  code: string;
  name: string;
  branch_id: number;
  branch_name: string;
  department_id: number;
  department_name: string;
}

export interface BranchRef {
  id: number;
  name: string;
  /** Active employees in this branch. */
  headcount: number;
}

export interface DepartmentRef {
  id: number;
  name: string;
  /** Active employees in this department (company-wide). */
  headcount: number;
}

/** Attendance-related settings (core.settings), read-only here. */
export interface AttendanceSettings {
  /** "HH:MM" after which an arrival counts as late. */
  late_after: string;
  /** Weekday number of the weekly off, 0 = Sunday … 6 = Saturday. */
  weekly_off: number;
}

// ------------------------------------------------------------ calendar

/** One calendar day as the API describes it (BS first, AD second). */
export interface DayHeader {
  /** "2083-06-01" */
  bs_date: string;
  /** Day of the BS month, 1-based. */
  bs_day: number;
  /** "2026-09-17" */
  ad_date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  is_weekly_off: boolean;
}

/** A BS month with its days, as returned inside the report. */
export interface BsMonthRef {
  bs_year: number;
  /** 1 = Baishakh … 12 = Chaitra. */
  bs_month: number;
  /** "Ashoj 2083" */
  label: string;
  /** "असोज २०८३" */
  label_np: string;
  /** "2083-06" – the value the month select uses. */
  key: string;
  ad_start: string;
  ad_end: string;
  days: DayHeader[];
  /** Days that are not the weekly off. */
  working_days: number;
}

/** A month option for the report's Month (BS) select. */
export interface MonthOption {
  key: string;
  label: string;
  label_np: string;
}

/** Today, as /api/today reports it (subset). */
export interface TodayRef {
  bs_date: string;
  ad_date: string;
  weekday: number;
  /** "Kartik 7, 2083" */
  bs_text: string;
  /** "शुक्रबार, कार्तिक ७, २०८३" */
  np_text: string;
}

// ------------------------------------------------------------ records

/** One attendance record: one row in attendance.records. */
export interface AttendanceRecord {
  employee_id: number;
  /** AD date, "YYYY-MM-DD". */
  date: string;
  bs_date: string;
  status: AttendanceStatus;
  /** "HH:MM" or null. */
  in_time: string | null;
  out_time: string | null;
  note: string;
  /** Username of the person who last marked the row. */
  marked_by: string;
  /** ISO timestamp. */
  updated_at: string;
}

/** A row of the Mark attendance screen: the employee and their record, if any. */
export interface MarkRow {
  employee: EmployeeRef;
  record: AttendanceRecord | null;
}

/** GET /api/attendance/day?date=<bs>&branch_id=<id> */
export interface DayAttendance {
  day: DayHeader;
  settings: AttendanceSettings;
  branches: BranchRef[];
  /** Departments present in the selected branch, with headcount in that branch. */
  departments: DepartmentRef[];
  rows: MarkRow[];
}

/** One employee's status for one day, as sent to the save endpoint. */
export interface MarkInput {
  employee_id: number;
  status: AttendanceStatus;
  in_time: string | null;
  out_time: string | null;
  note: string;
}

/** POST /api/attendance/day */
export interface SaveDayRequest {
  /** BS date. */
  date: string;
  marks: MarkInput[];
}

export interface SaveDayResponse {
  saved: number;
  records: AttendanceRecord[];
}

// ------------------------------------------------------------ report

export interface DayCell {
  status: DayStatus;
  in_time: string | null;
  out_time: string | null;
}

/** Per-employee counts over a range of days. */
export interface AttendanceTotals {
  present: number;
  late: number;
  half_day: number;
  leave: number;
  absent: number;
  weekly_off: number;
  not_marked: number;
  /** Days with any mark (present + late + half_day + leave + absent). */
  marked_days: number;
  /** present + late + half_day / 2 – the attendance numerator. */
  attended: number;
  /** present + late + leave + weekly_off + half_day / 2. Absent is unpaid. */
  paid_days: number;
}

export interface ReportRow {
  employee: EmployeeRef;
  /** One cell per day of the month, in `month.days` order. */
  cells: DayCell[];
  totals: AttendanceTotals;
}

/** GET /api/attendance/report?month=<YYYY-MM>&department_id=<id> */
export interface MonthReport {
  month: BsMonthRef;
  settings: AttendanceSettings;
  departments: DepartmentRef[];
  rows: ReportRow[];
  /** ISO timestamp of when the data was produced. */
  generated_at: string;
}

/** A week of the month, sliced client-side from the report. */
export interface WeekGrid {
  /** 1-based. */
  index: number;
  /** "Ashoj 1–3 (week 1)" */
  label: string;
  days: DayHeader[];
  /** Index of the first day of the week inside `month.days`. */
  offset: number;
}

export type ReportSort = "dept" | "name" | "absent" | "late";

export interface ReportFilters {
  month: string;
  /** null = all departments. */
  department_id: number | null;
  query: string;
  sort: ReportSort;
  group: boolean;
}

/** Export response: a file to hand to the browser. */
export interface ExportFile {
  filename: string;
  blob: Blob;
}

// ------------------------------------------------------------ dashboard

/** Data of the "attendance_stat" dashboard widget. */
export interface AttendanceStatWidgetData {
  present: number;
  total: number;
  late: number;
  leave: number;
  href: string;
}

export interface NotInEntry {
  employee_id: number;
  name: string;
  status: "absent" | "not_marked";
}

/** Data of the "attendance_today" dashboard widget. */
export interface AttendanceTodayWidgetData {
  total: number;
  on_time: number;
  late: number;
  half_day: number;
  leave: number;
  absent: number;
  not_marked: number;
  not_in: NotInEntry[];
  mark_path: string;
}
