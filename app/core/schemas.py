"""Pydantic schemas for the JSON API - the contract the Next.js app in ``web/`` codes against.

Keep these in sync with ``web/lib/api.ts``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.core import bsdate
from app.core.bsdate import BSDate
from app.core.models import Role, User

Tone = Literal["ok", "low", "danger", "leave", "neutral"]


class ErrorOut(BaseModel):
    detail: str


# ------------------------------------------------------------------ departments


class DepartmentIn(BaseModel):
    """Name of a department: trimmed, inner whitespace collapsed, 1-120 characters."""

    name: str

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Department name is required.")
        if len(value) > 120:
            raise ValueError("Department name is too long (120 characters at most).")
        return value


def _clean_name(value: str, what: str) -> str:
    value = " ".join(value.split())
    if not value:
        raise ValueError(f"{what} name is required.")
    if len(value) > 120:
        raise ValueError(f"{what} name is too long (120 characters at most).")
    return value


class BranchIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str) -> str:
        return _clean_name(value, "Branch")


class BranchPatchIn(BaseModel):
    """Rename and / or (de)activate a branch; at least one field."""

    name: str | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value, "Branch")


class BranchOut(BaseModel):
    """One row of GET /api/core/branches (web/app/people/types.ts Branch + counts)."""

    id: int
    name: str
    is_active: bool
    employee_count: int
    active_employee_count: int


class DepartmentOut(BaseModel):
    """One row of GET /api/core/departments (web/app/people/types.ts Department)."""

    id: int
    name: str
    #: Every employee referencing it, former staff included.
    employee_count: int
    active_employee_count: int


class UserOut(BaseModel):
    id: int
    username: str
    phone: str | None = None
    full_name: str
    role: Role
    role_label: str
    employee_id: int | None = None
    last_login_at: datetime | None = None
    #: True until the user replaces the temporary password an admin gave them.
    must_change_password: bool = False

    @classmethod
    def from_user(cls, user: User) -> UserOut:
        return cls(
            id=user.id,
            username=user.username,
            phone=user.phone,
            full_name=user.full_name,
            role=user.role,
            role_label=user.role_label,
            employee_id=user.employee_id,
            last_login_at=user.last_login_at,
            must_change_password=user.must_change_password,
        )


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)


class LoginIn(BaseModel):
    #: Phone number or username ("Phone or username" on the sign-in form).
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    remember: bool = False


class SessionOut(BaseModel):
    """``POST /api/auth/login``, ``GET /api/auth/me``, ``POST /api/auth/change-password``: the
    signed-in user plus what every screen needs to scope itself - the user's own branch and
    their effective permissions (``app.modules.admin.permissions``, every key present)."""

    user: UserOut
    csrf_token: str
    #: ``admin.user_access.branch_id``; ``None`` for admins (all branches) and unassigned users.
    branch_id: int | None = None
    #: Effective access, ``{permission: on}`` - role preset + per-user switches.
    access: dict[str, bool] = Field(default_factory=dict)


class CsrfOut(BaseModel):
    csrf_token: str


class NavItemOut(BaseModel):
    label: str
    path: str
    icon: str
    #: Role restriction on top of the permission (empty = any role).
    roles: list[str]
    #: The permission that unlocks the entry (``None`` = none needed).
    permission: str | None = None


class ModuleOut(BaseModel):
    name: str
    title: str
    nav: list[NavItemOut]
    allowed: bool


class RegistryOut(BaseModel):
    modules: list[ModuleOut]


class NavLinkOut(BaseModel):
    label: str
    path: str
    icon: str


class NavSectionOut(BaseModel):
    """One sidebar section: an enabled module with the nav items the caller's role may see."""

    module: str
    title: str
    items: list[NavLinkOut]


class ModulesOut(BaseModel):
    """``GET /api/core/modules``: what the frontend builds its menu and route guards from."""

    enabled: list[str]
    nav: list[NavSectionOut]


class WidgetOut(BaseModel):
    module: str
    kind: str
    title: str
    data: dict[str, Any] = Field(default_factory=dict)


class DashboardOut(BaseModel):
    """``GET /api/dashboard``: the enabled modules' widgets in sidebar order ("Attendance today",
    "Payments today"). The headline stat row comes from ``GET /api/today`` (``counts``)."""

    widgets: list[WidgetOut]


# ------------------------------------------------------------------------------- dates


class DateBoth(BaseModel):
    """A calendar day in both calendars. Every API response carries both; requests may send
    either ``date`` (AD) or ``date_bs`` (see :func:`resolve_date`)."""

    date: date
    date_bs: BSDate

    @classmethod
    def from_ad(cls, ad: date) -> DateBoth:
        return cls(date=ad, date_bs=bsdate.ad_to_bs(ad))

    @classmethod
    def from_bs(cls, bs: BSDate) -> DateBoth:
        return cls(date=bsdate.bs_to_ad(bs), date_bs=bs)


def resolve_date(ad: date | None, bs: BSDate | None, *, default: date | None = None) -> date:
    """The AD day a request means: ``date`` (AD) or ``date_bs``, which must agree when both are
    given. ``default`` (e.g. today in Kathmandu) applies when neither is; otherwise ValueError."""
    if bs is not None:
        from_bs = bsdate.bs_to_ad(bs)
        if ad is not None and ad != from_bs:
            raise ValueError(f"date {ad.isoformat()} and date_bs {bs} are different days")
        return from_bs
    if ad is not None:
        return ad
    if default is not None:
        return default
    raise ValueError("pass either date=YYYY-MM-DD (AD) or date_bs=YYYY-MM-DD (BS)")


class TodayText(BaseModel):
    np: str
    bs_en: str
    ad: str
    full: str


class TodayCountsOut(BaseModel):
    """Today's headline numbers for the dashboard stat row (Present today / Overtime today /
    Absent · not marked / Paid today). Each module fills the fields it owns through
    ``Module.today_counts``; a field stays ``None`` when its module is not enabled. Scope: the
    caller's own branch unless they hold ``see_other_branches`` (then every branch).

    Attendance (``app.modules.attendance``): ``total`` active employees, ``present`` marked P,
    ``overtime`` marked O (present with overtime), ``overtime_hours`` summed, ``absent`` marked A,
    ``not_marked`` without a record. Payroll (``app.modules.payroll``): ``paid_today`` rupees paid
    today (salary + advances), ``payments_today`` number of payments.

    Mock-backed until the attendance and payroll backends exist (the modules' ``SAMPLE_*``
    constants); the shape is the contract both backends implement.
    """

    total: int | None = None
    present: int | None = None
    overtime: int | None = None
    overtime_hours: int | None = None
    absent: int | None = None
    not_marked: int | None = None
    paid_today: int | None = None
    payments_today: int | None = None


class TodayOut(DateBoth):
    """GET /api/today: today in Asia/Kathmandu, both calendars and the header texts (public), plus
    ``counts`` for a signed-in caller (``None`` without a session)."""

    weekday: int = Field(description="0 = Sunday ... 6 = Saturday")
    fiscal_year: str = Field(description='e.g. "2083/84"')
    text: TodayText
    counts: TodayCountsOut | None = None


class BsConvertOut(DateBoth):
    weekday: int
    fiscal_year: str
    bs_text: str
    bs_text_np: str
    weekday_np: str


class ModuleStatusOut(BaseModel):
    module: str
    title: str
    status: Literal["coming_soon", "ready"]
