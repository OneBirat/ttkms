/**
 * Attendance module contract: the shapes the FastAPI endpoints under
 * /api/attendance return (app/modules/attendance/schemas.py, same field names)
 * and `web/components/attendance/api.ts` passes on. The node tests run on the
 * twin in `mock/mockApi.ts`. The endpoint for each shape is noted next to it and
 * in app/modules/attendance/API_NOTES.md.
 *
 * Dates: every record carries the BS date ("YYYY-MM-DD", Bikram Sambat) first
 * and the AD date second. The UI converts with web/components/attendance/bsdate.ts
 * (web/lib/bs, the shared calendar table).
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
  /** "Store keeper" (core.employees.designation); null when not set. */
  designation?: string | null;
  /** The 128 px photo thumbnail (versioned, signed-in users only); null = initials. */
  photo_url?: string | null;
  /** Code 128 value on the staff card, "TTK-E004" (server only). */
  barcode?: string;
  /** False for former staff (they still appear in past reports). */
  active?: boolean;
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
  /** 1 = Baisakh … 12 = Chaitra. */
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
  marked_via: "manual" | "scan" | "bulk";
  /** ISO timestamp. */
  updated_at: string;
}

/** A row of the Mark attendance screen: the employee and their record, if any. */
export interface MarkRow {
  employee: EmployeeRef;
  record: AttendanceRecord | null;
  /** Rupees paid that day (payroll contract); null / absent when nothing was paid. */
  payments_today?: { advance: number; salary: number } | null;
}

/**
 * GET /api/attendance/day?date_bs= (the user's ONE active branch)
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

/** DELETE /api/attendance/mark?employee_id=&date_bs= – "Clear mark", back to not marked. */
export interface ClearMarkResponse {
  date: string;
  date_bs: string;
  employee_id: number;
  /** What the day showed before ("N" when there was nothing to clear). */
  previous: CellStatus;
  /** "W" on the weekly off, else "N". */
  now: "W" | "N";
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
  /** From the lookup (payroll's by-barcode resolves the sticker). */
  employee_id: number;
  /** The code as scanned (kept for the sheets; the server goes by employee_id). */
  code?: string;
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
  /** Saturdays marked P / O (already counted in present / overtime_days above). Server only. */
  saturday_days_worked?: number;
  saturday_ot_hours?: number;
}

export interface ReportRow {
  employee: EmployeeRef;
  /** One cell per day of the month, in `month.days` order. */
  cells: DayCell[];
  totals: AttendanceTotals;
}

/** GET /api/attendance/report?bs_year=&bs_month= - the active branch (week / day / dept are sliced client-side) */
export interface MonthReport {
  month: BsMonthRef;
  settings: AttendanceSettings;
  /** Branches the user may report on (one entry for a single-branch user). */
  branches: BranchRef[];
  /** Departments present in the branch asked for (company-wide without a branch). */
  departments: DepartmentRef[];
  rows: ReportRow[];
  /** ISO timestamp of when the data was produced. */
  generated_at: string;
  /** The branch reported on (null = every branch). Server only. */
  branch_id?: number | null;
  /** Staff present (P or O) per day, in `month.days` order. Server only. */
  staff_present?: number[];
  /** Today's AD date. Server only. */
  today?: string;
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
  /** Branch to report on; null = every branch the user may see (admins only). */
  branch_id: number | null;
  /** null = all departments. */
  department_id: number | null;
  query: string;
  sort: ReportSort;
  group: boolean;
  /** Leave the Saturday columns out (PDF "Saturdays hidden" variant); totals still count them. */
  hide_weekly_off?: boolean;
  /** Only this employee's row (`?employee=` from the employee account's "View all ›"). */
  employee_id?: number | null;
}

/** Export response: a file to hand to the browser. */
export interface ExportFile {
  filename: string;
  blob: Blob;
}

// ------------------------------------------------------------ payroll client

/**
 * Payments belong to the PAYROLL module. Attendance only calls it through
 * api.ts (getMonthBalance / getPaymentHistoryFor / recordPayment); the shapes
 * below are the shared contract in `app/contracts.py` (`PayrollPayments`:
 * MonthBalance, PaymentInput, PaymentRecord, PaymentResult) - keep them in sync.
 */
export type PaymentKind = "salary" | "advance";
/** Alias the screens use for the chosen kind. */
export type PaymentType = PaymentKind;
export type PaymentSource = "scan" | "account";

/** admin.payment_modes row 1 is the built-in Cash mode. */
export const CASH_PAYMENT_MODE_ID = 1;

/** GET /api/payroll/balance?employee_id=&bs_year=&bs_month= */
export interface MonthBalance {
  employee_id: number;
  bs_year: number;
  bs_month: number;
  /** "2083-07" */
  month_key: string;
  /** "Kartik 2083" */
  month_label: string;
  /** Net earned so far this month, rupees. */
  earned: number;
  /** Salary and advances already paid against the month. */
  paid: number;
  /** earned - paid, never negative. */
  due: number;
}

/**
 * POST /api/payroll/payments body. The payment counts for the BS month `for_year` / `for_month`;
 * omitted (the scan flow), that is the month of the payment date (today when omitted too).
 */
export interface PaymentInput {
  employee_id: number;
  kind: PaymentKind;
  /** Whole rupees, > 0 and never above the month's `due`. */
  amount: number;
  /** Defaults to Cash (CASH_PAYMENT_MODE_ID). */
  payment_mode_id?: number;
  /** BS date "YYYY-MM-DD"; today when omitted. */
  date_bs?: string | null;
  /** The BS month the payment is for; both or neither. */
  for_year?: number | null;
  for_month?: number | null;
  note?: string;
  /** Where it was recorded; attendance always sends "scan". */
  source: PaymentSource;
}

/** One recorded payment, as the history sheet, the day pop-up and the report badges list it. */
export interface PaymentRecord {
  payment_id: number;
  /** "ADV-0412" / "SAL-0410" - the receipt number payroll prints. */
  receipt_no: string;
  employee_id: number;
  /** The BS month the payment counts for (not necessarily the month of `date`). */
  for_year: number;
  for_month: number;
  kind: PaymentKind;
  amount: number;
  payment_mode_id: number;
  /** "Cash", "Bank" ... */
  payment_mode: string;
  /** AD "YYYY-MM-DD". */
  date: string;
  /** BS "YYYY-MM-DD". */
  date_bs: string;
  note: string;
  source: PaymentSource;
  /** ISO timestamp. */
  recorded_at: string;
}

export interface PaymentResult {
  payment: PaymentRecord;
  /** Balance due for that month after this payment. */
  due_after: number;
}

/** GET /api/attendance/employees/{id}/month?bs_year=&bs_month= – one person's month (attendance record sheet). */
export interface EmployeeMonth {
  employee: EmployeeRef;
  month: BsMonthRef;
  /** One cell per day of the month; "N" for days not marked yet, "W" weekly off. */
  cells: DayCell[];
  totals: AttendanceTotals;
  /** That month's payments, newest first. */
  payments: PaymentRecord[];
}

/** GET /api/payroll/payments?employee_id=&bs_year=&bs_month= (newest first, with the month's balance). */
export interface PaymentHistory {
  employee_id: number;
  month_key: string;
  month_label: string;
  payments: PaymentRecord[];
  totals: { earned: number; paid: number; due: number };
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
