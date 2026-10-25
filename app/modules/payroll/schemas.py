"""Pydantic shapes of /api/payroll (the contract `web/app/people/types.ts` follows)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.contracts import TodayStatus
from app.core.bsdate import BSDate
from app.core.models import Role

PayType = Literal["monthly", "daily"]
PaymentKind = Literal["salary", "advance"]
PaymentSource = Literal["scan", "account"]
MonthStatus = Literal["paid", "part_paid", "pending"]


def clean_text(value: str) -> str:
    return " ".join(value.split())


def clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = clean_text(value)
    return cleaned or None


# ------------------------------------------------------------------------------- refs


class DateBothOut(BaseModel):
    """A day in both calendars, BS first."""

    bs: str
    ad: date


class BsMonthOut(BaseModel):
    bs_year: int
    bs_month: int


class BranchRef(BaseModel):
    id: int
    name: str
    is_active: bool


class DepartmentRef(BaseModel):
    id: int
    name: str


class PaymentModeRef(BaseModel):
    id: int
    type: str
    name: str


class LoginOut(BaseModel):
    user_id: int
    username: str
    role: Role
    role_label: str


# -------------------------------------------------------------------------- employees


class EmployeeOut(BaseModel):
    id: int
    code: str
    #: core.employees.barcode, "TTK-E001".
    barcode: str
    full_name: str
    full_name_np: str | None
    phone: str | None
    phone_alt: str | None
    address: str | None
    branch: BranchRef
    department: DepartmentRef | None
    designation: str | None
    active: bool
    joined: DateBothOut
    #: Authenticated URL of the stored photo; null = initials.
    photo_url: str | None
    login: LoginOut | None
    created_at: datetime


class EmployeeListRowOut(BaseModel):
    """One row of the all-staff table. Money fields are null unless the caller holds
    ``salary_advances``."""

    employee: EmployeeOut
    pay_type: PayType | None
    rate: int | None
    today: TodayStatus
    balance_due: int | None


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    role: Role = Role.staff


class EmployeeIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    full_name_np: str | None = Field(default=None, max_length=120)
    phone: str = Field(min_length=1, max_length=32)
    phone_alt: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=200)
    branch_id: int
    department_id: int
    designation: str = Field(min_length=1, max_length=80)
    pay_type: PayType
    #: Salary per month or wage per day, whole rupees.
    amount: int = Field(gt=0)
    #: ``admin.payment_modes`` row the person is usually paid with; null = Cash.
    default_payment_mode_id: int | None = None
    #: Joining date (BS); today when omitted.
    joined_bs: BSDate | None = None
    #: "data:image/jpeg;base64,..." from the popup's camera / file picker.
    photo_data_url: str | None = None
    login: LoginIn | None = None

    @field_validator("full_name", "designation")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("required")
        return value

    @field_validator("full_name_np", "phone_alt", "address")
    @classmethod
    def _clean_opt(cls, value: str | None) -> str | None:
        return clean_optional(value)


class EmployeeUpdateIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    full_name_np: str | None = Field(default=None, max_length=120)
    phone: str = Field(min_length=1, max_length=32)
    phone_alt: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=200)
    branch_id: int
    department_id: int
    designation: str = Field(min_length=1, max_length=80)
    active: bool = True
    joined_bs: BSDate

    @field_validator("full_name", "designation")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("required")
        return value

    @field_validator("full_name_np", "phone_alt", "address")
    @classmethod
    def _clean_opt(cls, value: str | None) -> str | None:
        return clean_optional(value)


class EmployeeCreatedOut(BaseModel):
    employee: EmployeeOut
    #: The temporary password of the new login (shown once); null without a login.
    one_time_password: str | None


class NextCodeOut(BaseModel):
    code: str
    barcode: str


# ------------------------------------------------------------------------------ salary


class SalaryStructureOut(BaseModel):
    id: int
    employee_id: int
    pay_type: PayType
    basic: int
    allowances: int
    #: basic + allowances (monthly: the salary per month; daily: the wage).
    gross: int
    ot_rate: int
    default_payment_mode_id: int
    default_payment_mode: PaymentModeRef
    effective_from: DateBothOut
    reason: str | None
    #: Gross of the row this one replaced, for "previous Rs X".
    previous_gross: int | None


class SalaryStructuresOut(BaseModel):
    current: SalaryStructureOut | None
    #: Newest first.
    history: list[SalaryStructureOut]


class SalaryRevisionIn(BaseModel):
    pay_type: PayType
    basic: int = Field(gt=0)
    allowances: int = Field(default=0, ge=0)
    #: Rupees per overtime hour; null = the default rule (salary / 30 / 8, wage / 8).
    ot_rate: int | None = Field(default=None, ge=0)
    default_payment_mode_id: int | None = None
    effective_from_bs: BSDate
    reason: str | None = Field(default=None, max_length=200)

    @field_validator("reason")
    @classmethod
    def _clean_opt(cls, value: str | None) -> str | None:
        return clean_optional(value)


# ----------------------------------------------------------------------------- ledgers


class MonthSummaryOut(BaseModel):
    days_in_month: int
    present: int
    overtime_days: int
    overtime_hours: int
    absent: int
    weekly_off: int
    paid_days: int


class PaymentOut(BaseModel):
    id: int
    receipt_no: str
    employee_id: int
    kind: PaymentKind
    #: The BS month the payment counts for (sent explicitly when recording).
    for_year: int
    for_month: int
    month: BsMonthOut
    amount: int
    payment_mode_id: int
    payment_mode: PaymentModeRef
    reference: str | None
    note: str | None
    date: DateBothOut
    paid_at: datetime
    #: Username of who recorded it ("" when that user is gone).
    recorded_by: str
    source: PaymentSource
    created_at: datetime


class MonthLedgerOut(BaseModel):
    employee_id: int
    month: BsMonthOut
    starts: DateBothOut
    ends: DateBothOut
    in_progress: bool
    pay_type: PayType
    #: Monthly: salary per month. Daily: wage per day.
    rate: int
    ot_rate: int
    attendance: MonthSummaryOut
    paid_days: int
    gross_salary: int
    overtime_pay: int
    earnings: int
    absence_deduction: int
    tds: int
    net: int
    salary_paid: int
    advance_paid: int
    paid: int
    due: int
    status: MonthStatus
    #: Oldest first.
    payments: list[PaymentOut]


# ------------------------------------------------------------------------------ report


class ReportRowOut(BaseModel):
    employee: EmployeeOut
    ledger: MonthLedgerOut


class ReportTotalsOut(BaseModel):
    staff: int
    gross: int
    absence_deduction: int
    absent_days: int
    overtime_pay: int
    overtime_hours: int
    advance_paid: int
    salary_paid: int
    tds: int
    net: int
    due: int
    paid_count: int
    part_paid_count: int
    pending_count: int


class MonthNetTotalOut(BaseModel):
    month: BsMonthOut
    net: int


class DepartmentNetTotalOut(BaseModel):
    department: DepartmentRef
    staff: int
    net: int


class BranchNetTotalOut(BaseModel):
    branch: BranchRef
    staff: int
    net: int
    paid: int
    due: int


class SalaryReportOut(BaseModel):
    month: BsMonthOut
    branch: BranchRef | None
    department: DepartmentRef | None
    rows: list[ReportRowOut]
    totals: ReportTotalsOut
    #: Every department of the branch scope, unfiltered by department.
    by_department: list[DepartmentNetTotalOut]
    #: Per branch with the department filter applied; one entry when a branch is chosen.
    by_branch: list[BranchNetTotalOut]
    #: Oldest first, the report month last.
    trend: list[MonthNetTotalOut]
    #: Staff on the sheet before the department filter.
    all_staff: int
