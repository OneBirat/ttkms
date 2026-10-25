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
