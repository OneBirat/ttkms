"""Module registry.

Each feature module (``app/modules/<name>/__init__.py``) exports ``module = Module(...)``.
``app.main`` imports the four modules once, from a fixed list, and mounts each router under
``/api/<name>``. The Next.js app builds its sidebar from ``GET /api/registry`` and its dashboard
from ``GET /api/dashboard`` - so a module worktree never has to edit core files.

Dashboard widgets are async callables ``widget(ctx: WidgetContext) -> dict`` returning
``{"kind": str, "title": str, "data": {...}}``; the frontend picks a component by ``kind``
(``web/components/widgets/index.tsx``).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter
from starlette.requests import Request

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.models import User

#: Fixed module order = sidebar order. Also used to build the template search path.
MODULE_NAMES: tuple[str, ...] = ("stock", "attendance", "payroll", "admin")


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
