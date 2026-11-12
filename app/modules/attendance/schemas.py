"""Pydantic shapes of /api/attendance - twins of ``web/components/attendance/types.ts``
(same field names). Every day carries the AD ``date`` and the BS ``date_bs``."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

MarkStatus = Literal["P", "O", "A"]
CellStatus = Literal["P", "O", "A", "W", "N"]
MarkedVia = Literal["manual", "scan", "bulk"]


class EmployeeRef(BaseModel):
    id: int
    code: str
    #: "TTK-E001" (core.employees.barcode).
    barcode: str
    name: str
    name_ne: str | None = None
    branch_id: int
    branch_name: str
    #: 0 / "" when the employee has no department.
    department_id: int
    department_name: str
    #: core.employees.designation ("Store keeper"); the phone report's card line.
    designation: str | None = None
    #: The 128 px photo thumbnail (versioned, signed-in users only); null = initials.
    photo_url: str | None = None
    active: bool


class BranchRef(BaseModel):
    id: int
    name: str
    headcount: int


class DepartmentRef(BaseModel):
    id: int
    name: str
    headcount: int


class AttendanceSettings(BaseModel):
    #: 0 = Sunday ... 6 = Saturday.
    weekly_off: int


class DayHeader(BaseModel):
    bs_date: str
    bs_day: int
    ad_date: date
    weekday: int
    is_weekly_off: bool


class AttendanceRecord(BaseModel):
    employee_id: int
    date_bs: str
    date_ad: date
    status: MarkStatus
    ot_hours: int
    note: str
    #: Username of whoever marked it last ("" when that user is gone).
    marked_by: str
    marked_via: MarkedVia
    updated_at: datetime
    #: When the mark was first saved; it can be changed or removed until ``editable_until``
    #: (24 hours later - editing does not extend it).
    created_at: datetime
    editable_until: datetime
    #: True once that window has passed: only the super admin can change it now.
    locked: bool


class PaymentFlags(BaseModel):
    """Rupees paid that day (any month they count for)."""

    advance: int = 0
    salary: int = 0


class DayLock(BaseModel):
    """What the caller may do on this day (the API enforces it; the screens only show it).

    * ``open`` - today: marking works as always.
    * ``locked`` - a past day: nobody can be newly marked; a mark saved less than 24 hours ago
      can still be changed (its ``locked`` is false) and everything else is read-only.
    * ``override`` - a past day for the super admin: everything can be created, changed or
      removed, and every such change needs a ``reason``.
    """

    mode: Literal["open", "locked", "override"]
    is_today: bool
    #: New marks (one by one and in bulk) are possible.
    can_create: bool
    #: Every write on this day must carry a reason (the super admin on a past day).
    reason_required: bool = False
    #: "Kartik 14, 2083"
    date_label: str
    #: The banner above the list ("" on an open day).
    message: str


class MarkRow(BaseModel):
    employee: EmployeeRef
    record: AttendanceRecord | None
    payments_today: PaymentFlags | None = None


class DayAttendance(BaseModel):
    date: date
    date_bs: str
    day: DayHeader
    settings: AttendanceSettings
    lock: DayLock
    branches: list[BranchRef]
    departments: list[DepartmentRef]
    rows: list[MarkRow]


class MarkOneRequest(BaseModel):
    date_bs: str
    employee_id: int
    status: MarkStatus
    ot_hours: int = 0
    note: str | None = Field(default=None, max_length=200)
    #: Required (at least 5 characters) when the super admin changes a past day.
    reason: str | None = Field(default=None, max_length=300)


class MarkOneResponse(BaseModel):
    date: date
    date_bs: str
    record: AttendanceRecord
    previous: CellStatus


class ClearMarkResponse(BaseModel):
    date: date
    date_bs: str
    employee_id: int
    #: What the day showed before ("N" when there was nothing to clear).
    previous: CellStatus
    #: What it shows now: "W" on the weekly off, else "N".
    now: Literal["W", "N"]


class BulkMarkRequest(BaseModel):
    date_bs: str
    branch_id: int
    employee_ids: list[int] | None = None
    department_id: int | None = None
    #: Required (at least 5 characters) when the super admin bulk-marks a past day.
    reason: str | None = Field(default=None, max_length=300)


class MarkedName(BaseModel):
    employee_id: int
    name: str


class BulkMarkResponse(BaseModel):
    date: date
    date_bs: str
    marked: list[MarkedName]
    skipped: list[int]
    records: list[AttendanceRecord]


class LookupResponse(BaseModel):
    """The scan flow's "who is this and are they marked today" (after payroll's by-barcode)."""

    date: date
    date_bs: str
    #: The sticker value, "TTK-E001".
    code: str
    employee: EmployeeRef
    today: AttendanceRecord | None


class ScanRequest(BaseModel):
    employee_id: int
    action: Literal["present", "overtime"]
    ot_hours: int = 0


class ScanResponse(BaseModel):
    date: date
    date_bs: str
    employee: EmployeeRef
    record: AttendanceRecord
    previous: CellStatus


# ---------------------------------------------------------------------------------- report


class BsMonthRef(BaseModel):
    bs_year: int
    bs_month: int
    #: "Kartik 2083"
    label: str
    #: "कार्तिक २०८३"
    label_np: str
    #: "2083-07"
    key: str
    ad_start: date
    ad_end: date
    days: list[DayHeader]
    #: Days that are not the weekly off.
    working_days: int


class CellOverride(BaseModel):
    """The latest super-admin change to this day (the report's and calendar's small dot)."""

    #: Full name of the super admin who made it.
    by: str
    at: datetime
    #: The Kathmandu BS day of ``at``, "2083-07-26".
    at_bs: str
    #: "N" = it was not marked before / the mark was removed.
    old_status: Literal["P", "O", "A", "N"]
    old_hours: int = 0
    new_status: Literal["P", "O", "A", "N"]
    new_hours: int = 0
    reason: str
    #: "Changed by Owner Shrestha on Kartik 26, 2083: P → A · Was on site"
    text: str


class DayCell(BaseModel):
    status: CellStatus
    ot_hours: int = 0
    #: An "N" cell that counts as a not-marked day: a working day before today, inside the
    #: employee's active period, without a record. Unpaid (payroll deducts it like an absence);
    #: the screens show it red. False for today, future days and days before joining.
    not_marked: bool = False
    #: Set when the super admin changed this day after it locked; left out otherwise.
    override: CellOverride | None = None
    #: Rupees paid that day (payments counting for this month); left out when none.
    advance: int | None = None
    salary: int | None = None


class AttendanceTotals(BaseModel):
    """``computeTotals`` in web/components/attendance/helpers.ts: a Saturday worked counts in
    present / overtime_days; the saturday_* fields count it again on its own. ``not_marked``
    is the payroll figure (MonthSummary.not_marked): past working days without a record, from
    joining - never today, a future day or a day before joining."""

    present: int = 0
    overtime_days: int = 0
    overtime_hours: int = 0
    absent: int = 0
    weekly_off: int = 0
    not_marked: int = 0
    marked_days: int = 0
    attended: int = 0
    paid_days: int = 0
    saturday_days_worked: int = 0
    saturday_ot_hours: int = 0


class ReportRow(BaseModel):
    employee: EmployeeRef
    cells: list[DayCell]
    totals: AttendanceTotals


class MonthReport(BaseModel):
    month: BsMonthRef
    settings: AttendanceSettings
    #: The branch reported on: the caller's active branch (or ``?branch=`` with
    #: see_other_branches). Never null any more.
    branch_id: int | None
    branches: list[BranchRef]
    departments: list[DepartmentRef]
    rows: list[ReportRow]
    #: Staff present (P or O) per day, in ``month.days`` order.
    staff_present: list[int]
    #: Today's AD date (days after it are still to come in the running month).
    today: date
    generated_at: datetime


class PaymentOut(BaseModel):
    """app/contracts.py PaymentRecord (types.ts PaymentRecord)."""

    payment_id: int
    receipt_no: str
    employee_id: int
    for_year: int
    for_month: int
    kind: Literal["salary", "advance"]
    amount: int
    payment_mode_id: int
    payment_mode: str
    date: date
    date_bs: str
    note: str
    source: Literal["scan", "account"]
    recorded_at: datetime


class EmployeeMonth(BaseModel):
    employee: EmployeeRef
    month: BsMonthRef
    cells: list[DayCell]
    totals: AttendanceTotals
    #: Newest first.
    payments: list[PaymentOut]


class OverrideChange(BaseModel):
    employee_id: int
    #: The new mark; null = remove the mark.
    status: MarkStatus | None
    ot_hours: int = 0


class OverridePreviewRequest(BaseModel):
    """What the super admin is about to change on a past day (one person, or several for a
    bulk "Mark as Present")."""

    date_bs: str
    changes: list[OverrideChange] = Field(min_length=1, max_length=500)


class PayrollImpact(BaseModel):
    """What the change does to the pay of the month of that day."""

    #: "Ashwin 2083"
    month_label: str
    for_year: int
    for_month: int
    #: Already paid against the month (salary + advances, voided ones left out).
    paid: int
    net_before: int
    net_after: int
    #: net_after - net_before (negative = the net pay goes down).
    net_change: int
    due_before: int
    due_after: int
    #: Paid more than the new net pay by this much (0 when not).
    overpaid: int
    #: The sentence for the confirm sheet when the month is already paid (fully or partly) and
    #: the net pay changes; null otherwise. It warns, it never blocks.
    warning: str | None


class OverridePreviewItem(BaseModel):
    employee_id: int
    name: str
    old_status: Literal["P", "O", "A", "N"]
    old_hours: int = 0
    new_status: Literal["P", "O", "A", "N"]
    new_hours: int = 0
    #: null when payroll has nothing for that month (no salary set up, payroll paused).
    payroll: PayrollImpact | None


class OverridePreview(BaseModel):
    date: date
    date_bs: str
    items: list[OverridePreviewItem]
    #: Every item's warning, one per line (the employee's name in front when there are
    #: several); null when nothing already paid changes.
    warning: str | None


class HistoryEntry(BaseModel):
    """One row of ``attendance.record_changes``: a mark created, changed or removed."""

    id: int
    #: "N" = not marked before / the mark was removed.
    old_status: Literal["P", "O", "A", "N"]
    old_hours: int = 0
    new_status: Literal["P", "O", "A", "N"]
    new_hours: int = 0
    #: Who (full name at the time) and when.
    by: str
    at: datetime
    at_bs: str
    via: MarkedVia
    #: True for a super-admin change to a past day; then ``reason`` is set.
    is_override: bool
    reason: str


class MarkHistory(BaseModel):
    """GET /history: every change to one employee's mark on one day, oldest first."""

    employee_id: int
    date: date
    date_bs: str
    entries: list[HistoryEntry]


class MarkedDays(BaseModel):
    bs_year: int
    bs_month: int
    #: BS dates with at least one mark (the BSDatePicker dots).
    marked_days: list[str]
