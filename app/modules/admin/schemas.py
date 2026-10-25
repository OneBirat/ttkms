"""Pydantic schemas of the admin JSON API (mirrored by ``web/components/admin/types.ts``)."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.models import PHONE_RE, Role, normalize_phone

_WS = re.compile(r"\s+")
PHONE_ERROR = "Enter a 10-digit mobile number starting with 97 or 98."


def clean_text(value: str) -> str:
    return _WS.sub(" ", value).strip()


# ----------------------------------------------------------------------------- users


class BranchRefOut(BaseModel):
    id: int
    name: str
    is_active: bool = True


class EmployeeRefOut(BaseModel):
    id: int
    code: str
    full_name: str
    phone: str | None = None
    department: str | None = None
    branch_id: int
    status: str
    #: The user this employee is already linked to, if any (the form hides those).
    user_id: int | None = None


class AdminUserOut(BaseModel):
    id: int
    full_name: str
    phone: str | None
    username: str
    role: Role
    role_label: str
    is_active: bool
    is_you: bool
    must_change_password: bool
    branch: BranchRefOut | None
    employee: EmployeeRefOut | None
    last_login_at: datetime | None
    last_login_at_bs: str | None
    #: Effective permissions (preset + overrides), every key present.
    access: dict[str, bool]
    #: True when ``access`` differs from the role preset.
    custom: bool


class UserIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    #: The login: 10 digits starting 97/98 (spaces, dashes and +977 are stripped).
    phone: str = Field(min_length=1, max_length=20)
    role: Role
    #: Required for managers and staff; always null (all branches) for admins.
    branch_id: int | None = None
    employee_id: int | None = None
    #: Per-permission switches; null = use the role preset.
    access: dict[str, bool] | None = None

    @field_validator("full_name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Full name is required.")
        return value

    @field_validator("phone")
    @classmethod
    def _clean_phone(cls, value: str) -> str:
        phone = normalize_phone(value)
        if not PHONE_RE.match(phone):
            raise ValueError(PHONE_ERROR)
        return phone


class ActiveIn(BaseModel):
    is_active: bool


class UserCreatedOut(BaseModel):
    user: AdminUserOut
    #: Shown once; the user must replace it at first sign-in.
    temporary_password: str


class TemporaryPasswordOut(BaseModel):
    user_id: int
    full_name: str
    temporary_password: str


class UserOptionsOut(BaseModel):
    """Choices for the user form."""

    branches: list[BranchRefOut]
    employees: list[EmployeeRefOut]


class PermissionOut(BaseModel):
    key: str
    label: str
    description: str


class PermissionGroupOut(BaseModel):
    title: str
    items: list[PermissionOut]


class PermissionsOut(BaseModel):
    groups: list[PermissionGroupOut]
    presets: dict[str, list[str]]


# --------------------------------------------------------------------- payment modes

PaymentModeType = Literal["cash", "bank", "wallet", "qr", "cheque"]
EditableModeType = Literal["bank", "wallet", "qr", "cheque"]


class PaymentModeOut(BaseModel):
    id: int
    type: PaymentModeType
    name: str
    details: str | None
    use_salary: bool
    use_advance: bool
    active: bool
    #: Cash: cannot be edited or turned off.
    is_builtin: bool
    #: Payments recorded with this mode (from payroll.payments once that table exists).
    payment_count: int
    created_at: datetime


class PaymentModeIn(BaseModel):
    type: EditableModeType
    name: str = Field(min_length=1, max_length=80)
    details: str | None = Field(default=None, max_length=120)
    use_salary: bool = True
    use_advance: bool = True

    @field_validator("name")
    @classmethod
    def _clean_mode_name(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("details")
    @classmethod
    def _clean_details(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = clean_text(value)
        return value or None

    @model_validator(mode="after")
    def _at_least_one_use(self) -> PaymentModeIn:
        if not (self.use_salary or self.use_advance):
            raise ValueError("Pick at least one use: salary payments or advances.")
        return self


class PaymentModeActiveIn(BaseModel):
    active: bool


# -------------------------------------------------------------------------- barcodes


class BarcodeEmployeeOut(BaseModel):
    id: int
    code: str
    full_name: str
    department: str | None
    designation: str | None
    branch_id: int
    branch: str
    #: What the sticker encodes: core.employees.barcode, "TTK-E001".
    barcode: str


class StickerSizeOut(BaseModel):
    key: str
    label: str
    columns: int
    rows: int
    per_page: int


class BarcodesOut(BaseModel):
    employees: list[BarcodeEmployeeOut]
    sizes: list[StickerSizeOut]
    pdf_available: bool
