"""Pydantic schemas for the JSON API - the contract the Next.js app in ``web/`` codes against.

Keep these in sync with ``web/lib/api.ts``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.models import Role, User

Tone = Literal["ok", "low", "danger", "leave", "neutral"]


class ErrorOut(BaseModel):
    detail: str


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: Role
    role_label: str
    employee_id: int | None = None
    last_login_at: datetime | None = None

    @classmethod
    def from_user(cls, user: User) -> UserOut:
        return cls(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            role_label=user.role_label,
            employee_id=user.employee_id,
            last_login_at=user.last_login_at,
        )


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    remember: bool = False


class SessionOut(BaseModel):
    user: UserOut
    csrf_token: str


class CsrfOut(BaseModel):
    csrf_token: str


class NavItemOut(BaseModel):
    label: str
    path: str
    icon: str
    roles: list[str]


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


class TodayText(BaseModel):
    np: str
    bs_en: str
    ad: str
    full: str


class TodayOut(BaseModel):
    ad: date
    bs: str | None
    available: bool
    text: TodayText


class BsConvertOut(BaseModel):
    ad: date
    bs: str
    bs_text: str
    bs_text_np: str
    weekday_np: str


class ModuleStatusOut(BaseModel):
    module: str
    title: str
    status: Literal["coming_soon", "ready"]
