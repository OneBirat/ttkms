"""Jinja2 environment shared by core and the modules.

Template search path: ``app/core/templates`` first, then ``app/modules/<name>/templates`` for
every module - namespace module templates (``app/modules/stock/templates/stock/...``) so names
never collide. Filters: ``bs``, ``bs_np``, ``bs_long``, ``np_digits``. Request context (sidebar
modules, current user, CSRF token, today's date strings, flashes) comes from :func:`base_context`.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from typing import Any

from fastapi import Request
from fastapi.templating import Jinja2Templates
from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.responses import Response

from app.config import APP_DIR, STATIC_DIR, settings
from app.core import bsdate
from app.core.csrf import get_csrf_token
from app.core.flash import pop_flashes
from app.core.modules import MODULE_NAMES

TEMPLATE_DIRS = [
    APP_DIR / "core" / "templates",
    *[APP_DIR / "modules" / name / "templates" for name in MODULE_NAMES],
]
DATEPICKER_JS = STATIC_DIR / "vendor" / "nepali.datepicker.v4.min.js"
DATEPICKER_CSS = STATIC_DIR / "vendor" / "nepali.datepicker.v4.min.css"


def _as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(bsdate.KATHMANDU).date()
    if isinstance(value, date):
        return value
    raise TypeError(f"expected a date, got {type(value).__name__}")


def bs_filter(value: Any) -> str:
    """AD date -> "2083-07-04" (BS). Falls back to the AD date + " AD" while the table is absent."""
    ad = _as_date(value)
    if ad is None:
        return ""
    if not bsdate.is_available():
        return f"{ad.isoformat()} AD"
    return bsdate.ad_to_bs(ad).isoformat()


def bs_np_filter(value: Any) -> str:
    """AD date -> "२०८३-०७-०४"."""
    return bsdate.to_devanagari_digits(bs_filter(value))


def bs_long_filter(value: Any, nepali: bool = False) -> str:
    """AD date -> "Kartik 4, 2083" / "कार्तिक ४, २०८३"."""
    ad = _as_date(value)
    if ad is None:
        return ""
    if not bsdate.is_available():
        text = f"{ad.day} {ad:%b} {ad.year}"
        return bsdate.to_devanagari_digits(text) if nepali else text
    return bsdate.ad_to_bs(ad).format(nepali=nepali)


def datepicker_available() -> bool:
    return DATEPICKER_JS.exists()


env = Environment(
    loader=FileSystemLoader([str(path) for path in TEMPLATE_DIRS]),
    autoescape=select_autoescape(("html", "htm", "xml")),
    trim_blocks=True,
    lstrip_blocks=True,
)
env.filters.update(
    bs=bs_filter,
    bs_np=bs_np_filter,
    bs_long=bs_long_filter,
    np_digits=bsdate.to_devanagari_digits,
)
env.globals.update(app_name="TTK", settings=settings)


def base_context(request: Request) -> dict[str, Any]:
    has_session = "session" in request.scope
    return {
        "current_user": getattr(request.state, "user", None),
        "csrf_token": get_csrf_token(request) if has_session else "",
        "modules": getattr(request.app.state, "modules", []),
        "today": bsdate.header_date(),
        "has_datepicker": datepicker_available(),
        "flashes": lambda: pop_flashes(request),
    }


templates = Jinja2Templates(env=env, context_processors=[base_context])


def render(
    request: Request,
    name: str,
    context: Mapping[str, Any] | None = None,
    *,
    status_code: int = 200,
    headers: Mapping[str, str] | None = None,
) -> Response:
    return templates.TemplateResponse(
        request, name, dict(context or {}), status_code=status_code, headers=headers
    )


def render_fragment(request: Request, name: str, context: Mapping[str, Any]) -> str:
    """Render a template to a string with the same request context as a full page."""
    full = {**base_context(request), "request": request, **context}
    return env.get_template(name).render(full)


def render_placeholder(request: Request, *, title: str, subtitle: str = "") -> Response:
    return render(request, "module_placeholder.html", {"title": title, "subtitle": subtitle})
