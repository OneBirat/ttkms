/**
 * Attendance module contract: the shapes `web/components/attendance/api.ts`
 * returns today from mock data and the FastAPI endpoints under
 * /api/attendance will return once the UI is signed off. Keep the two in sync;
 * the endpoint for each shape is noted next to it and in
 * app/modules/attendance/API_NOTES.md.
 *
 * Dates: every record carries the BS date ("YYYY-MM-DD", Bikram Sambat) first
 * and the AD date second. The UI converts with web/components/attendance/bsdate.ts
 * (a wrapper over @remotemerge/nepali-date-converter).
 */

// ------------------------------------------------------------ statuses

/** The only statuses a record can have: Present, Overtime (present + whole hours), Absent. */
export type MarkStatus = "P" | "O" | "A";

/** What one report cell can show: a mark, the weekly off ("–") or nothing yet. */
export type CellStatus = MarkStatus | "W" | "N";

export const MARK_STATUSES: readonly MarkStatus[] = ["P", "O", "A"];

/** Overtime is whole hours only. */
export const OT_MIN = 1;
export const OT_MAX = 12;

// ------------------------------------------------------------ core refs

/** Read-only view of core.employees joined with branch and department. */
export interface EmployeeRef {
  id: number;
  /** "E-004" – also printed on the staff card as Code 128 "TTK-E004". */
  code: string;
  name: string;
  /** Name in Devanagari (payroll's optional "Name in Nepali"); spoken by the scan flow. */
  name_ne?: string | null;
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
  /** Active employees in this department (in the branch asked for, else company-wide). */
  headcount: number;
}

/** Attendance-related settings (core.settings), read-only here. */
export interface AttendanceSettings {
  /** Weekday number of the weekly off, 0 = Sunday … 6 = Saturday. */
  weekly_off: number;
}

// ------------------------------------------------------------ calendar

/** One calendar day (BS first, AD second). */
export interface DayHeader {
  /** "2083-07-04" */
  bs_date: string;
  /** Day of the BS month, 1-based. */
  bs_day: number;
  /** "2026-10-21" */
  ad_date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  is_weekly_off: boolean;
}

/** A BS month with its days. */
export interface BsMonthRef {
  bs_year: number;
  /** 1 = Baishakh … 12 = Chaitra. */
  bs_month: number;
  /** "Kartik 2083" */
  label: string;
  /** "कार्तिक २०८३" */
  label_np: string;
  /** "2083-07" – the value the month select uses. */
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

/** Today, BS first. */
export interface TodayRef {
  bs_date: string;
  ad_date: string;
  weekday: number;
  /** "Kartik 4, 2083" */
  bs_text: string;
  /** "बुधबार, कार्तिक ४" */
  np_text: string;
  /** "21 Oct 2026" */
  ad_text: string;
}

// ------------------------------------------------------------ records

/** One row in attendance.records. */
export interface AttendanceRecord {
  employee_id: number;
  date_bs: string;
  date_ad: string;
  status: MarkStatus;
  /** 1–12 when status is "O", otherwise 0. */
  ot_hours: number;
  note: string;
  /** Username of the person who last marked the row. */
  marked_by: string;
  marked_via: "manual" | "scan";
  /** ISO timestamp. */
  updated_at: string;
}

/** A row of the Mark attendance screen: the employee and their record, if any. */
export interface MarkRow {
  employee: EmployeeRef;
  record: AttendanceRecord | null;
}

/**
 * GET /api/attendance/day?date_bs=&branch=
 * Every active employee of the branch with that day's record (the web UI
 * filters by department / search / "only not marked" and pages locally so the
 * counts and "mark remaining" cover the whole scope and unsaved marks survive
 * paging).
 */
export interface DayAttendance {
  day: DayHeader;
  settings: AttendanceSettings;
  branches: BranchRef[];
  /** Departments in the selected branch, with headcount in that branch. */
  departments: DepartmentRef[];
  rows: MarkRow[];
}

/** One employee's mark for one day, as sent to the save endpoint. */
export interface MarkInput {
  employee_id: number;
  status: MarkStatus;
  /** 1–12 with "O", 0 otherwise. */
  ot_hours: number;
  note: string;
}

/** PUT /api/attendance/day – all rows are saved or none. */
export interface SaveDayRequest {
  date_bs: string;
  rows: MarkInput[];
}

export interface SaveDayResponse {
  saved: number;
  records: AttendanceRecord[];
}

/** POST /api/attendance/mark – one person, saved at once (the screens no longer batch). */
export interface MarkOneRequest {
  date_bs: string;
  employee_id: number;
  status: MarkStatus;
  /** 1–12 with "O", 0 otherwise. */
  ot_hours: number;
  note?: string;
}

export interface MarkOneResponse {
  record: AttendanceRecord;
  /** The status before this save, "N" when there was none. */
  previous: CellStatus;
}

/**
 * POST /api/attendance/bulk-mark – marks Present, in one transaction, only the
 * employees of the scope that have no record for the day yet. Either a list of
 * ids (the selected rows) or a whole department of a branch.
 */
export interface BulkMarkRequest {
  date_bs: string;
  branch_id: number;
  employee_ids?: number[];
  department_id?: number;
}

export interface BulkMarkResponse {
  marked: { employee_id: number; name: string }[];
  /** Ids that already had a record and were left untouched. */
  skipped: number[];
  records: AttendanceRecord[];
}

/** GET /api/attendance/lookup?code=TTK-E004 */
export interface LookupResponse {
  /** The code as scanned/typed. */
  code: string;
  employee: EmployeeRef;
  /** Today's record, null when not marked yet. */
  today: AttendanceRecord | null;
}

/** POST /api/attendance/scan – marks today immediately (marked_via "scan"). */
export interface ScanRequest {
  code: string;
  action: "present" | "overtime";
  /** Required with "overtime". */
  ot_hours: number;
}

export interface ScanResponse {
  employee: EmployeeRef;
  record: AttendanceRecord;
}

// ------------------------------------------------------------ report

export interface DayCell {
  status: CellStatus;
  /** Overtime hours when status is "O", else 0. */
  ot_hours: number;
  /** Rupees of advance / salary paid that day (report payment icons); absent or 0 when none. */
  advance?: number;
  salary?: number;
}

/** Per-employee counts over a range of days. */
export interface AttendanceTotals {
  /** Days marked P. */
  present: number;
  /** Days marked O. */
  overtime_days: number;
  /** Sum of ot_hours over the O days. */
  overtime_hours: number;
  absent: number;
  weekly_off: number;
  not_marked: number;
  /** Days with any mark (present + overtime_days + absent). */
  marked_days: number;
  /** present + overtime_days – the attendance numerator. */
  attended: number;
  /** present + overtime_days + weekly_off. Absent is unpaid. */
  paid_days: number;
}

export interface ReportRow {
  employee: EmployeeRef;
  /** One cell per day of the month, in `month.days` order. */
  cells: DayCell[];
  totals: AttendanceTotals;
}

/** GET /api/attendance/report?bs_year=&bs_month=  (week & dept are sliced client-side) */
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
  /** "Kartik 1–7 (week 1)" */
  label: string;
  days: DayHeader[];
  /** Index of the first day of the week inside `month.days`. */
  offset: number;
}

export type ReportSort = "dept" | "name" | "absent" | "overtime";

export interface ReportFilters {
  /** Month key "YYYY-MM" (BS). */
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

// ------------------------------------------------------------ payroll client

/**
 * Payments belong to the PAYROLL module. Attendance only calls it through
 * api.ts (getMonthBalance / recordPayment); the shapes below are the contract
 * payroll implements (see API_NOTES.md, "Needs from main").
 */
export interface MonthBalance {
  employee_id: number;
  /** "2083-07" */
  month_key: string;
  /** "Kartik 2083" */
  month_label: string;
  /** Net salary of the month, rupees. */
  net: number;
  /** Already paid this month (advances and part payments). */
  paid: number;
  /** net - paid, never negative. */
  due: number;
}

export type PaymentType = "salary" | "advance";
export type PaymentMethod = "cash" | "bank";

export interface PaymentInput {
  employee_id: number;
  month_key: string;
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  /** Where it was recorded; attendance always sends "scan". */
  source: "scan";
}

export interface PaymentResult {
  payment_id: number;
  amount: number;
  /** Balance due after this payment. */
  due_after: number;
  recorded_at: string;
}

/** One payment of the month, as the scan flow's history sheet lists it. */
export interface PaymentEntry {
  id: number;
  /** BS date "YYYY-MM-DD". */
  bs_date: string;
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  /** "Cash", "Part salary", … */
  note: string;
  /** ISO timestamp. */
  created_at: string;
}

/** GET /api/attendance/employees/{id}/month?bs_year=&bs_month= – one person's month (attendance record sheet). */
export interface EmployeeMonth {
  employee: EmployeeRef;
  month: BsMonthRef;
  /** One cell per day of the month; "N" for days not marked yet, "W" weekly off. */
  cells: DayCell[];
  totals: AttendanceTotals;
  /** That month's payments, newest first. */
  payments: PaymentEntry[];
}

/** GET /api/payroll/payments?employee_id=&bs_year=&bs_month= (newest first). */
export interface PaymentHistory {
  employee_id: number;
  month_key: string;
  month_label: string;
  payments: PaymentEntry[];
  totals: { paid: number; net: number; due: number };
}

// ------------------------------------------------------------ dashboard

export interface NotInEntry {
  employee_id: number;
  name: string;
  /** "A" absent, "N" not marked. */
  status: "A" | "N";
}

/** Data of the "attendance_today" dashboard widget. */
export interface AttendanceTodayWidgetData {
  total: number;
  /** Marked P. */
  present: number;
  /** Marked O (present with overtime). */
  overtime: number;
  absent: number;
  not_marked: number;
  overtime_hours: number;
  not_in: NotInEntry[];
  mark_path: string;
}
