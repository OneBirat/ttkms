"""Jinja2 environment for server-rendered documents.

The user interface lives in the Next.js app (``web/``); FastAPI renders HTML only for WeasyPrint
PDFs. Template search path: ``app/core/templates`` first, then ``app/modules/<name>/templates`` so a
module can ship its own print templates (namespace them: ``app/modules/stock/templates/stock/...``).
Filters: ``bs``, ``bs_np``, ``bs_long``, ``np_digits``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import APP_DIR
from app.core import bsdate
from app.core.modules import MODULE_NAMES

TEMPLATE_DIRS = [
    APP_DIR / "core" / "templates",
    *[APP_DIR / "modules" / name / "templates" for name in MODULE_NAMES],
]


def _as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(bsdate.KATHMANDU).date()
    if isinstance(value, date):
        return value
    raise TypeError(f"expected a date, got {type(value).__name__}")


def _to_bs(ad: date) -> bsdate.BSDate | None:
    """BS date, or None when the table is absent or the date lies outside it (never raises)."""
    try:
        return bsdate.ad_to_bs(ad)
    except (bsdate.BSCalendarUnavailable, ValueError):
        return None


def bs_filter(value: Any) -> str:
    """AD date -> "2083-07-04" (BS). Falls back to the AD date + " AD" when no BS date exists."""
    ad = _as_date(value)
    if ad is None:
        return ""
    bs = _to_bs(ad)
    return bs.isoformat() if bs else f"{ad.isoformat()} AD"


def bs_np_filter(value: Any) -> str:
    """AD date -> "२०८३-०७-०४"."""
    return bsdate.to_devanagari_digits(bs_filter(value))


def bs_long_filter(value: Any, nepali: bool = False) -> str:
    """AD date -> "Kartik 4, 2083" / "कार्तिक ४, २०८३"."""
    ad = _as_date(value)
    if ad is None:
        return ""
    bs = _to_bs(ad)
    if bs is None:
        text = f"{ad.day} {ad:%b} {ad.year}"
        return bsdate.to_devanagari_digits(text) if nepali else text
    return bs.format(nepali=nepali)


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
env.globals.update(app_name="TTK")
