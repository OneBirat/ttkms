"""Module registry.

Each feature module (``app/modules/<name>/__init__.py``) exports ``module = Module(...)``.
``app.main`` imports the four modules once, from a fixed list, mounts each router under
``/<name>`` and builds the sidebar and the dashboard from this registry - so a module worktree
never has to edit core files.

Dashboard widgets are async callables ``widget(ctx: WidgetContext) -> str`` that return an HTML
fragment; render a module template with ``ctx.render("stock/widgets/low_stock.html", {...})``.
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
    path: str
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

    def render(self, template_name: str, context: dict[str, Any] | None = None) -> str:
        from app.core.templating import render_fragment

        return render_fragment(self.request, template_name, context or {})


DashboardWidget = Callable[[WidgetContext], Awaitable[str]]


@dataclass
class Module:
    name: str
    title: str
    router: APIRouter
    nav: list[NavItem]
    dashboard_widgets: list[Callable] = field(default_factory=list)

    def visible_nav(self, role: str | None) -> list[NavItem]:
        return [item for item in self.nav if item.visible_to(role)]


def coming_soon_widget(title: str, note: str = "") -> DashboardWidget:
    """Placeholder dashboard widget used by the module stubs."""

    async def widget(ctx: WidgetContext) -> str:
        return ctx.render("partials/widget_coming_soon.html", {"title": title, "note": note})

    widget.__name__ = f"coming_soon_{title.lower().replace(' ', '_')}"
    return widget
