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


class PaymentFlags(BaseModel):
    """Rupees paid that day (any month they count for)."""

    advance: int = 0
    salary: int = 0


class MarkRow(BaseModel):
    employee: EmployeeRef
    record: AttendanceRecord | None
    payments_today: PaymentFlags | None = None


class DayAttendance(BaseModel):
    date: date
    date_bs: str
    day: DayHeader
    settings: AttendanceSettings
    branches: list[BranchRef]
    departments: list[DepartmentRef]
    rows: list[MarkRow]


class MarkOneRequest(BaseModel):
    date_bs: str
    employee_id: int
    status: MarkStatus
    ot_hours: int = 0
    note: str | None = Field(default=None, max_length=200)


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


class DayCell(BaseModel):
    status: CellStatus
    ot_hours: int = 0
    #: Rupees paid that day (payments counting for this month); left out when none.
    advance: int | None = None
    salary: int | None = None


class AttendanceTotals(BaseModel):
    """``computeTotals`` in web/components/attendance/helpers.ts: a Saturday worked counts in
    present / overtime_days; the saturday_* fields count it again on its own."""

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
    #: The branch reported on; null = every branch (see_other_branches only).
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


class MarkedDays(BaseModel):
    bs_year: int
    bs_month: int
    #: BS dates with at least one mark (the BSDatePicker dots).
    marked_days: list[str]
