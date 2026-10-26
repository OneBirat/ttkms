"""Module registry.

Each feature module (``app/modules/<name>/__init__.py``) exports ``module = Module(...)``.
``app.main`` loads the modules listed in ``ENABLED_MODULES`` (:func:`load_modules`), in the fixed
sidebar order, and mounts each router under ``/api/<name>``. A module that is not enabled is not
even imported: no routes (``/api/<name>/*`` is 404), no nav items, no dashboard widgets. Code
outside a module that touches it must guard with :func:`is_enabled`. The Next.js app builds its
sidebar from ``GET /api/core/modules`` and its dashboard from ``GET /api/dashboard`` - so a module
worktree never has to edit core files.

Dashboard widgets are async callables ``widget(ctx: WidgetContext) -> dict`` returning
``{"kind": str, "title": str, "data": {...}}``; the frontend picks a component by ``kind``
(``web/components/widgets/index.tsx``). A module may also contribute to the dashboard's headline
numbers through ``Module.today_counts`` - an async callable returning a subset of the
``TodayCountsOut`` fields (``app.core.schemas``), merged by ``GET /api/today``.

Sidebar visibility is decided per user from their *effective access* - the role preset plus the
per-user switches of ``app.modules.admin.permissions`` - not from the role alone. A
:class:`NavItem` names the ``permission`` that unlocks it (``mark_attendance``, ...), optionally
restricted to ``roles`` on top; the core routes resolve the caller's access once per request and
hand it to :meth:`Module.visible_nav`. A module is "allowed" when at least one entry is visible.
"""

from __future__ import annotations

import importlib
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter
from starlette.requests import Request

from app.config import KNOWN_MODULES, settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.models import User

#: Fixed module order = sidebar order. Also used to build the template search path.
MODULE_NAMES: tuple[str, ...] = KNOWN_MODULES


def enabled_modules() -> tuple[str, ...]:
    """Names from ``ENABLED_MODULES`` in sidebar order (read live from settings)."""
    return settings.enabled_module_names


def is_enabled(name: str) -> bool:
    """True when module ``name`` is switched on. Use it to guard any cross-module code path
    (e.g. a dashboard widget that reads another module's tables) so it degrades instead of
    crashing."""
    return name in enabled_modules()


def load_modules(enabled: Iterable[str] | None = None) -> list[Module]:
    """Import and return the ``module`` objects of the enabled modules, in sidebar order.
    ``enabled`` defaults to :func:`enabled_modules`; a disabled module is never imported."""
    names = enabled_modules() if enabled is None else tuple(enabled)
    return [
        importlib.import_module(f"app.modules.{name}").module
        for name in MODULE_NAMES
        if name in names
    ]


#: ``{permission: on}`` for one user - what ``app.modules.admin.permissions.effective_access``
#: returns. Core only reads it; the catalogue of keys lives in the admin module.
Access = Mapping[str, bool]


@dataclass
class NavItem:
    label: str
    path: str  # frontend path, e.g. "/attendance/mark"
    icon: str
    #: Empty = any role. Use it only for screens that have no per-user switch (admin-only tools).
    roles: set[str] = field(default_factory=set)
    #: The permission that unlocks this entry; ``None`` = no permission needed.
    permission: str | None = None

    def visible_to(self, role: str | None, access: Access | None = None) -> bool:
        """Visible when the role is admitted (``roles`` empty or containing it) *and* the user's
        ``access`` has the entry's ``permission`` switched on (no permission = always)."""
        if role is None:
            return False
        if self.roles and role not in self.roles:
            return False
        if self.permission is None:
            return True
        return bool(access and access.get(self.permission))


@dataclass
class WidgetContext:
    request: Request
    user: User
    db: AsyncSession


DashboardWidget = Callable[[WidgetContext], Awaitable[dict[str, Any]]]
#: ``today_counts(ctx) -> {field: int}`` for the fields of ``TodayCountsOut`` a module owns.
TodayCounts = Callable[[WidgetContext], Awaitable[dict[str, Any]]]
#: ``dashboard_today(db, user, branch_id) -> {section: data}`` - the module's part of
#: ``GET /api/dashboard/today`` / ``/compare`` for ONE branch (never several added together), or
#: ``{}`` when the user may not see it.
DashboardToday = Callable[["AsyncSession", "User", int], Awaitable[dict[str, Any]]]


@dataclass
class Module:
    name: str
    title: str
    router: APIRouter
    nav: list[NavItem]
    dashboard_widgets: list[Callable] = field(default_factory=list)
    #: Headline numbers for today (attendance: present / overtime / absent / not marked;
    #: payroll: paid today). ``None`` = the module has nothing to report.
    today_counts: TodayCounts | None = None
    #: Its section of the per-branch dashboard (attendance: ``attendance``; payroll: ``payments``).
    dashboard_today: DashboardToday | None = None

    def visible_nav(self, role: str | None, access: Access | None = None) -> list[NavItem]:
        return [item for item in self.nav if item.visible_to(role, access)]

    def allowed(self, role: str | None, access: Access | None = None) -> bool:
        """True when the user may see at least one sidebar entry of this module."""
        return bool(self.visible_nav(role, access))

    @property
    def permissions(self) -> frozenset[str]:
        """Every permission named by this module's nav (what unlocks the module at all)."""
        return frozenset(item.permission for item in self.nav if item.permission)
