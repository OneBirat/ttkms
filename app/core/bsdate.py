"""Bikram Sambat (BS) calendar.

The month-length table (BS 1970-2099) and the anchor (BS 2000-09-17 = AD 1944-01-01) must be
ported from ``static/vendor/nepali.datepicker.v4.min.js`` so the server and the browser
date-picker agree exactly. They live in ``app/core/bs_calendar_data.py`` (generated from the vendor
file - see ``scripts/port_bs_calendar.py``). Until that data module exists every conversion
raises :class:`BSCalendarUnavailable` and the UI falls back to AD dates; :func:`is_available`
tells callers which situation they are in.

Store AD ``date`` columns in the database; display BS everywhere (``|bs`` / ``|bs_np`` filters).

TODO: BS 2082+ month lengths must be checked against the official government calendar.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import cache
from types import ModuleType
from zoneinfo import ZoneInfo

KATHMANDU = ZoneInfo("Asia/Kathmandu")

MONTH_NAMES_EN: tuple[str, ...] = (
    "Baishakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
    "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
)  # fmt: skip
MONTH_NAMES_NP: tuple[str, ...] = (
    "बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
    "कार्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत",
)  # fmt: skip
# Sunday .. Saturday
WEEKDAY_NAMES_EN: tuple[str, ...] = (
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
)  # fmt: skip
WEEKDAY_NAMES_NP: tuple[str, ...] = (
    "आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहिबार", "शुक्रबार", "शनिबार",
)  # fmt: skip
WEEKDAY_INITIALS_NP: tuple[str, ...] = ("आ", "सो", "मं", "बु", "बि", "शु", "श")

_DEVANAGARI = str.maketrans("0123456789", "०१२३४५६७८९")
_ISO_RE = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$")


class BSCalendarUnavailable(RuntimeError):
    """The BS month table has not been ported from the vendor date-picker yet."""


@dataclass(frozen=True, order=True)
class BSDate:
    year: int
    month: int
    day: int

    def isoformat(self) -> str:
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    __str__ = isoformat

    def format(self, nepali: bool = False) -> str:
        """``"Kartik 4, 2083"`` or ``"कार्तिक ४, २०८३"``."""
        if nepali:
            month = month_name(self.month, nepali=True)
            return f"{month} {to_devanagari_digits(self.day)}, {to_devanagari_digits(self.year)}"
        return f"{month_name(self.month)} {self.day}, {self.year}"

    def to_ad(self) -> date:
        return bs_to_ad(self)

    @classmethod
    def parse(cls, text: str) -> BSDate:
        return parse_bs(text)


# --------------------------------------------------------------------------- data access


def _load_data() -> ModuleType:
    try:
        from app.core import bs_calendar_data as data
    except ImportError as exc:
        raise BSCalendarUnavailable(
            "app/core/bs_calendar_data.py is missing: port the month table and anchor from "
            "static/vendor/nepali.datepicker.v4.min.js (scripts/port_bs_calendar.py)."
        ) from exc
    table = data.BS_MONTH_DAYS
    for year, months in table.items():
        if len(months) != 12 or not all(28 <= m <= 32 for m in months):
            raise BSCalendarUnavailable(f"bad month table for BS {year}: {months!r}")
    return data


@cache
def _data() -> ModuleType:
    return _load_data()


def is_available() -> bool:
    try:
        _data()
    except BSCalendarUnavailable:
        return False
    return True


def year_range() -> tuple[int, int]:
    years = sorted(_data().BS_MONTH_DAYS)
    return years[0], years[-1]


@cache
def _year_offsets() -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Sorted years and, for each, the ordinal of its first day (first table day = 0)."""
    table = _data().BS_MONTH_DAYS
    years = tuple(sorted(table))
    offsets, total = [], 0
    for year in years:
        offsets.append(total)
        total += sum(table[year])
    return years, tuple(offsets)


@cache
def _total_days() -> int:
    return sum(sum(months) for months in _data().BS_MONTH_DAYS.values())


def _anchor() -> tuple[BSDate, date]:
    data = _data()
    return BSDate(*data.ANCHOR_BS), data.ANCHOR_AD


# --------------------------------------------------------------------------- public API


def days_in_month(year: int, month: int) -> int:
    table = _data().BS_MONTH_DAYS
    if year not in table:
        lo, hi = year_range()
        raise ValueError(f"BS year {year} is outside the table ({lo}-{hi})")
    if not 1 <= month <= 12:
        raise ValueError(f"BS month must be 1-12, got {month}")
    return table[year][month - 1]


def validate(bs: BSDate) -> BSDate:
    if not 1 <= bs.day <= days_in_month(bs.year, bs.month):
        raise ValueError(f"invalid BS date {bs.isoformat()}")
    return bs


def _ordinal(bs: BSDate) -> int:
    validate(bs)
    years, offsets = _year_offsets()
    months = _data().BS_MONTH_DAYS[bs.year]
    return offsets[years.index(bs.year)] + sum(months[: bs.month - 1]) + bs.day - 1


@cache
def _anchor_ordinal() -> int:
    return _ordinal(_anchor()[0])


def bs_to_ad(bs: BSDate) -> date:
    return _anchor()[1] + timedelta(days=_ordinal(bs) - _anchor_ordinal())


def ad_to_bs(ad: date) -> BSDate:
    if isinstance(ad, datetime):
        ad = ad.astimezone(KATHMANDU).date()
    target = _anchor_ordinal() + (ad - _anchor()[1]).days
    if not 0 <= target < _total_days():
        lo, hi = year_range()
        raise ValueError(f"{ad.isoformat()} is outside the BS table ({lo}-{hi})")
    years, offsets = _year_offsets()
    index = bisect_right(offsets, target) - 1
    year = years[index]
    remaining = target - offsets[index]
    for month, length in enumerate(_data().BS_MONTH_DAYS[year], start=1):
        if remaining < length:
            return BSDate(year, month, remaining + 1)
        remaining -= length
    raise AssertionError("unreachable: ordinal beyond year length")  # pragma: no cover


def today_ad() -> date:
    return datetime.now(KATHMANDU).date()


def today_bs() -> BSDate:
    return ad_to_bs(today_ad())


def month_name(month: int, nepali: bool = False) -> str:
    if not 1 <= month <= 12:
        raise ValueError(f"BS month must be 1-12, got {month}")
    return (MONTH_NAMES_NP if nepali else MONTH_NAMES_EN)[month - 1]


def weekday_index(ad: date) -> int:
    """0 = Sunday ... 6 = Saturday."""
    return (ad.weekday() + 1) % 7


def weekday_initial(ad: date) -> str:
    """One of आ सो मं बु बि शु श."""
    return WEEKDAY_INITIALS_NP[weekday_index(ad)]


def weekday_name(ad: date, nepali: bool = False) -> str:
    return (WEEKDAY_NAMES_NP if nepali else WEEKDAY_NAMES_EN)[weekday_index(ad)]


def to_devanagari_digits(value: object) -> str:
    return str(value).translate(_DEVANAGARI)


def parse_bs(text: str) -> BSDate:
    """Parse ``"YYYY-MM-DD"`` (validated against the month table when it is available)."""
    match = _ISO_RE.match(str(text))
    if not match:
        raise ValueError(f"expected a BS date as YYYY-MM-DD, got {text!r}")
    bs = BSDate(*(int(part) for part in match.groups()))
    if not 1 <= bs.month <= 12 or not 1 <= bs.day <= 32:
        raise ValueError(f"invalid BS date {text!r}")
    return validate(bs) if is_available() else bs


def format_bs(bs: BSDate) -> str:
    return bs.isoformat()


# --------------------------------------------------------------------------- header


@dataclass(frozen=True)
class HeaderDate:
    """Today's date for the page header / print header.

    ``full`` renders as "मंगलबार, कार्तिक ४, २०८३ · Kartik 4, 2083 BS · Tue 20 Oct 2026" when the
    BS table is available, otherwise just the AD part.
    """

    ad_date: date
    bs_date: BSDate | None

    @property
    def available(self) -> bool:
        return self.bs_date is not None

    @property
    def ad(self) -> str:
        d = self.ad_date
        return f"{d:%a} {d.day} {d:%b} {d.year}"

    @property
    def bs_en(self) -> str:
        return f"{self.bs_date.format()} BS" if self.bs_date else ""

    @property
    def np(self) -> str:
        if not self.bs_date:
            return ""
        return f"{weekday_name(self.ad_date, nepali=True)}, {self.bs_date.format(nepali=True)}"

    @property
    def full(self) -> str:
        parts = [self.np, self.bs_en, self.ad] if self.bs_date else [self.ad]
        return " · ".join(parts)


def header_date(ad: date | None = None) -> HeaderDate:
    ad = ad or today_ad()
    try:
        bs = ad_to_bs(ad)
    except (BSCalendarUnavailable, ValueError):
        bs = None
    return HeaderDate(ad, bs)
