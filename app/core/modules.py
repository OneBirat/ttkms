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
(``web/components/widgets/index.tsx``).
"""

from __future__ import annotations

import importlib
from collections.abc import Awaitable, Callable, Iterable
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
    (e.g. a dashboard widget that reads stock tables) so it degrades instead of crashing."""
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


@dataclass
class NavItem:
    label: str
    path: str  # frontend path, e.g. "/stock/items"
    icon: str
    roles: set[str]

    def visible_to(self, role: str | None) -> bool:
        """An empty ``roles`` set means "every signed-in user"."""
        if role is None:
            return False
        return not self.roles or role in self.roles


@dataclass
class WidgetContext:
    request: Request
    user: User
    db: AsyncSession


DashboardWidget = Callable[[WidgetContext], Awaitable[dict[str, Any]]]


@dataclass
class Module:
    name: str
    title: str
    router: APIRouter
    nav: list[NavItem]
    dashboard_widgets: list[Callable] = field(default_factory=list)

    def visible_nav(self, role: str | None) -> list[NavItem]:
        return [item for item in self.nav if item.visible_to(role)]

    def allowed(self, role: str | None) -> bool:
        return bool(self.visible_nav(role))


def coming_soon_widget(title: str, note: str = "") -> DashboardWidget:
    """Placeholder dashboard widget used by the module stubs."""

    async def widget(ctx: WidgetContext) -> dict[str, Any]:
        return {"kind": "coming_soon", "title": title, "data": {"note": note}}

    widget.__name__ = f"coming_soon_{title.lower().replace(' ', '_')}"
    return widget
