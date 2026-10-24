"""Pydantic schemas for the JSON API - the contract the Next.js app in ``web/`` codes against.

Keep these in sync with ``web/lib/api.ts``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core import bsdate
from app.core.bsdate import BSDate
from app.core.models import Role, User

Tone = Literal["ok", "low", "danger", "leave", "neutral"]


class ErrorOut(BaseModel):
    detail: str


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


class StatOut(BaseModel):
    label: str
    value: float | int
    hint: str | None = None
    tone: Tone | None = None
    href: str | None = None


class WidgetOut(BaseModel):
    module: str
    kind: str
    title: str
    data: dict[str, Any] = Field(default_factory=dict)


class DashboardOut(BaseModel):
    stats: list[StatOut]
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


class TodayOut(DateBoth):
    """GET /api/today: today in Asia/Kathmandu."""

    weekday: int = Field(description="0 = Sunday ... 6 = Saturday")
    fiscal_year: str = Field(description='e.g. "2083/84"')
    text: TodayText


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
