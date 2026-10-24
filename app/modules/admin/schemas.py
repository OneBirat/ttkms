"""Pydantic schemas of the admin JSON API (mirrored by ``web/components/admin/types.ts``)."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

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
