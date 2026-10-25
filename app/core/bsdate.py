"""Bikram Sambat (BS) calendar and Nepal time.

BS month lengths come from a published table and cannot be calculated. The table lives in
``web/lib/bs/calendar-data.json`` (generated from the ``nepali-datetime`` package by
``scripts/gen_bs_calendar.py``) and official corrections in ``web/lib/bs/calendar-overrides.json``.
The backend and the frontend read the same two files, so they can never disagree.
See docs/bs-calendar.md.

Time rules: timestamps are stored as timestamptz (UTC); calendar days (an attendance day, a
payment date) as plain AD ``date`` columns. "Today", "this month" and day boundaries are always
computed in Asia/Kathmandu (:data:`KATHMANDU`), never in server or browser local time.
"""

from __future__ import annotations

import json
import re
from bisect import bisect_right
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import GetCoreSchemaHandler
from pydantic_core import core_schema

KATHMANDU_NAME = "Asia/Kathmandu"
KATHMANDU = ZoneInfo(KATHMANDU_NAME)

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_PATH = BASE_DIR / "web" / "lib" / "bs" / "calendar-data.json"
OVERRIDES_PATH = BASE_DIR / "web" / "lib" / "bs" / "calendar-overrides.json"

Lang = Literal["en", "ne"]

MONTH_NAMES_EN: tuple[str, ...] = (
    "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
    "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
)  # fmt: skip
MONTH_NAMES_NE: tuple[str, ...] = (
    "बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
    "कार्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत",
)  # fmt: skip
# Sunday .. Saturday
WEEKDAY_NAMES_EN: tuple[str, ...] = (
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
)  # fmt: skip
WEEKDAY_NAMES_NE: tuple[str, ...] = (
    "आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहिबार", "शुक्रबार", "शनिबार",
)  # fmt: skip
WEEKDAY_SHORT_NE: tuple[str, ...] = ("आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि")
WEEKDAY_INITIALS_NE: tuple[str, ...] = ("आ", "सो", "मं", "बु", "बि", "शु", "श")
SATURDAY = 6

_DEVANAGARI = str.maketrans("0123456789", "०१२३४५६७८९")
_ISO_RE = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$")


def to_nepali_digits(value: object) -> str:
    """``2083`` -> ``"२०८३"``; every ASCII digit is swapped, other characters are kept."""
    return str(value).translate(_DEVANAGARI)


# ------------------------------------------------------------------------------ calendar table


@dataclass(frozen=True)
class Calendar:
    """The BS table: for every supported year its 12 month lengths and the AD date of 1 Baisakh."""

    first_year: int
    last_year: int
    months: dict[int, tuple[int, ...]]
    new_year: dict[int, date]
    overridden: frozenset[int]
    _new_year_ordinals: tuple[int, ...]

    @property
    def end_ad(self) -> date:
        """The day after the last supported day."""
        last = self.last_year
        return self.new_year[last] + timedelta(days=sum(self.months[last]))


def _year_entry(year: int, raw: Any, origin: str) -> tuple[tuple[int, ...], date]:
    if not isinstance(raw, dict) or not {"months", "new_year_ad"} <= set(raw):
        raise ValueError(f"{origin}: BS {year} needs 'months' and 'new_year_ad'")
    months = raw["months"]
    if (
        not isinstance(months, list)
        or len(months) != 12
        or not all(isinstance(m, int) and 28 <= m <= 32 for m in months)
    ):
        raise ValueError(f"{origin}: BS {year} must list 12 month lengths of 28-32 days")
    try:
        new_year = date.fromisoformat(raw["new_year_ad"])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{origin}: BS {year} new_year_ad must be YYYY-MM-DD") from exc
    return tuple(months), new_year


def load_calendar(
    data_path: Path = DATA_PATH, overrides_path: Path | None = OVERRIDES_PATH
) -> Calendar:
    """Read the generated table and apply the overrides file (a listed year wins outright).

    Raises ValueError when a year is malformed or when consecutive years disagree (1 Baisakh of
    the next year must be this year's 1 Baisakh plus the sum of its months). An override that
    changes a year's length must therefore also override the following year's ``new_year_ad``.
    """
    data = json.loads(data_path.read_text(encoding="utf-8"))
    months: dict[int, tuple[int, ...]] = {}
    new_year: dict[int, date] = {}
    for key, raw in data["years"].items():
        months[int(key)], new_year[int(key)] = _year_entry(int(key), raw, data_path.name)
    overridden: set[int] = set()
    if overrides_path is not None and overrides_path.exists():
        overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
        for key, raw in (overrides.get("years") or {}).items():
            year = int(key)
            months[year], new_year[year] = _year_entry(year, raw, overrides_path.name)
            overridden.add(year)
    years = sorted(months)
    if not years or years != list(range(years[0], years[-1] + 1)):
        raise ValueError("BS calendar must cover a contiguous range of years")
    for year in years[:-1]:
        expected = new_year[year] + timedelta(days=sum(months[year]))
        if expected != new_year[year + 1]:
            where = "calendar-overrides.json" if {year, year + 1} & overridden else data_path.name
            raise ValueError(
                f"{where}: BS {year} ends on {expected - timedelta(days=1)} but BS {year + 1} "
                f"starts on {new_year[year + 1]}"
            )
    return Calendar(
        first_year=years[0],
        last_year=years[-1],
        months=months,
        new_year=new_year,
        overridden=frozenset(overridden),
        _new_year_ordinals=tuple(new_year[y].toordinal() for y in years),
    )


@cache
def calendar() -> Calendar:
    return load_calendar()


def year_range() -> tuple[int, int]:
    cal = calendar()
    return cal.first_year, cal.last_year


def days_in_month(year: int, month: int) -> int:
    cal = calendar()
    if year not in cal.months:
        raise ValueError(f"BS year {year} is outside the table ({cal.first_year}-{cal.last_year})")
    if not 1 <= month <= 12:
        raise ValueError(f"BS month must be 1-12, got {month}")
    return cal.months[year][month - 1]


def days_in_year(year: int) -> int:
    return sum(days_in_month(year, month) for month in range(1, 13))


# ------------------------------------------------------------------------------------- BSDate


@dataclass(frozen=True, order=True)
class BSDate:
    """A Bikram Sambat calendar day. Also a Pydantic type: validated from/serialised to
    ``"YYYY-MM-DD"``."""

    year: int
    month: int
    day: int

    def isoformat(self) -> str:
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    __str__ = isoformat

    def format(self, fmt: str = "%B %-d, %Y", lang: Lang = "en") -> str:
        return format_bs(self, fmt, lang)

    def to_ad(self) -> date:
        return bs_to_ad(self)

    @property
    def weekday(self) -> int:
        """0 = Sunday ... 6 = Saturday."""
        return weekday_index(self.to_ad())

    @classmethod
    def from_ad(cls, ad: date | datetime) -> BSDate:
        return ad_to_bs(ad)

    @classmethod
    def parse(cls, text: str) -> BSDate:
        return parse_bs(text)

    @classmethod
    def __get_pydantic_core_schema__(
        cls, _source: type[Any], _handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        from_str = core_schema.no_info_after_validator_function(
            parse_bs, core_schema.str_schema(pattern=r"^\d{4}-\d{1,2}-\d{1,2}$")
        )
        return core_schema.json_or_python_schema(
            json_schema=from_str,
            python_schema=core_schema.union_schema([core_schema.is_instance_schema(cls), from_str]),
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda value: value.isoformat(), when_used="always"
            ),
        )


def validate(bs: BSDate) -> BSDate:
    if not 1 <= bs.day <= days_in_month(bs.year, bs.month):
        raise ValueError(f"invalid BS date {bs.isoformat()}")
    return bs


def parse_bs(text: str) -> BSDate:
    """Parse and validate ``"YYYY-MM-DD"`` (also accepts an existing :class:`BSDate`)."""
    if isinstance(text, BSDate):
        return validate(text)
    match = _ISO_RE.match(str(text))
    if not match:
        raise ValueError(f"expected a BS date as YYYY-MM-DD, got {text!r}")
    return validate(BSDate(*(int(part) for part in match.groups())))


def bs_to_ad(bs: BSDate) -> date:
    validate(bs)
    cal = calendar()
    offset = sum(cal.months[bs.year][: bs.month - 1]) + bs.day - 1
    return cal.new_year[bs.year] + timedelta(days=offset)


def kathmandu_date(value: date | datetime) -> date:
    """The Kathmandu calendar day of a timestamp (naive datetimes are taken as UTC)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(KATHMANDU).date()
    return value


def ad_to_bs(ad: date | datetime) -> BSDate:
    ad = kathmandu_date(ad)
    cal = calendar()
    index = bisect_right(cal._new_year_ordinals, ad.toordinal()) - 1
    if index < 0 or ad >= cal.end_ad:
        raise ValueError(
            f"{ad.isoformat()} is outside the BS table ({cal.first_year}-{cal.last_year})"
        )
    year = cal.first_year + index
    remaining = (ad - cal.new_year[year]).days
    for month, length in enumerate(cal.months[year], start=1):
        if remaining < length:
            return BSDate(year, month, remaining + 1)
        remaining -= length
    raise AssertionError("unreachable: day beyond year length")  # pragma: no cover


# ----------------------------------------------------------------------------------------- time


def utc_now() -> datetime:
    """The current instant, UTC - the one clock behind every "today" (``today_ad``,
    ``today_bs``, attendance's day, payroll's running month). The test-suite freezes it
    (tests/conftest.py, ``TTK_TEST_TODAY``)."""
    return datetime.now(UTC)


def now_kathmandu(now: datetime | None = None) -> datetime:
    """The current (or given) instant as an aware datetime in Asia/Kathmandu."""
    if now is None:
        now = utc_now()
    elif now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now.astimezone(KATHMANDU)


def today_ad(now: datetime | None = None) -> date:
    return now_kathmandu(now).date()


def today_bs(now: datetime | None = None) -> BSDate:
    return ad_to_bs(today_ad(now))


def day_bounds(ad: date) -> tuple[datetime, datetime]:
    """``[start, end)`` of the Kathmandu calendar day ``ad`` as aware UTC datetimes - the window
    a timestamptz must fall in to belong to that attendance day."""
    start = datetime.combine(ad, datetime.min.time(), tzinfo=KATHMANDU)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


# --------------------------------------------------------------------------------------- months


def bs_month_range(year: int, month: int) -> tuple[date, date]:
    """First and last AD day (inclusive) of a BS month, e.g. ``bs_month_range(2083, 7)`` ->
    ``(2026-10-18, 2026-11-16)``."""
    start = bs_to_ad(BSDate(year, month, 1))
    return start, start + timedelta(days=days_in_month(year, month) - 1)


def bs_month_name(month: int, lang: Lang = "en") -> str:
    if not 1 <= month <= 12:
        raise ValueError(f"BS month must be 1-12, got {month}")
    return (MONTH_NAMES_NE if lang == "ne" else MONTH_NAMES_EN)[month - 1]


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


@dataclass(frozen=True)
class FiscalYear:
    """A Nepali fiscal year runs Shrawan 1 .. Ashadh end: ``FiscalYear(2083)`` is "2083/84"."""

    start_year: int

    @property
    def label(self) -> str:
        return f"{self.start_year}/{(self.start_year + 1) % 100:02d}"

    @property
    def start(self) -> BSDate:
        return BSDate(self.start_year, 4, 1)

    @property
    def end(self) -> BSDate:
        return BSDate(self.start_year + 1, 3, days_in_month(self.start_year + 1, 3))


def fiscal_year(bs: BSDate) -> FiscalYear:
    return FiscalYear(bs.year if bs.month >= 4 else bs.year - 1)


# ------------------------------------------------------------------------------------- weekdays


def weekday_index(ad: date) -> int:
    """0 = Sunday ... 6 = Saturday."""
    return (ad.weekday() + 1) % 7


def weekday_name(value: date | BSDate, lang: Lang = "en") -> str:
    ad = value.to_ad() if isinstance(value, BSDate) else value
    return (WEEKDAY_NAMES_NE if lang == "ne" else WEEKDAY_NAMES_EN)[weekday_index(ad)]


def weekday_initial(value: date | BSDate) -> str:
    """One of आ सो मं बु बि शु श."""
    ad = value.to_ad() if isinstance(value, BSDate) else value
    return WEEKDAY_INITIALS_NE[weekday_index(ad)]


# ----------------------------------------------------------------------------------- formatting

_FMT_RE = re.compile(r"%(-?[YmdBbAa]|%)")


def format_bs(bs: BSDate, fmt: str = "%B %-d, %Y", lang: Lang = "en") -> str:
    """strftime-style formatting of a BS date.

    ``%Y`` year, ``%m``/``%-m`` month (padded / plain), ``%d``/``%-d`` day, ``%B`` month name,
    ``%b`` first three letters of it, ``%A`` weekday, ``%a`` short weekday, ``%%``. With
    ``lang="ne"`` the names are Nepali and every digit is Devanagari, so
    ``format_bs(BSDate(2083, 7, 7))`` is ``"Kartik 7, 2083"`` and ``"कार्तिक ७, २०८३"`` in Nepali.
    """
    nepali = lang == "ne"
    weekday: int | None = None

    def replace(match: re.Match[str]) -> str:
        nonlocal weekday
        code = match.group(1)
        if code == "%":
            return "%"
        if code == "Y":
            return f"{bs.year:04d}"
        if code == "m":
            return f"{bs.month:02d}"
        if code == "-m":
            return str(bs.month)
        if code == "d":
            return f"{bs.day:02d}"
        if code == "-d":
            return str(bs.day)
        if code == "B":
            return bs_month_name(bs.month, lang)
        if code == "b":
            name = bs_month_name(bs.month, lang)
            return name if nepali else name[:3]
        if weekday is None:
            weekday = bs.weekday
        if code == "A":
            return (WEEKDAY_NAMES_NE if nepali else WEEKDAY_NAMES_EN)[weekday]
        return WEEKDAY_SHORT_NE[weekday] if nepali else WEEKDAY_NAMES_EN[weekday][:3]

    text = _FMT_RE.sub(replace, fmt)
    return to_nepali_digits(text) if nepali else text


def format_ad(ad: date, fmt: str = "%-d %b %Y") -> str:
    """AD date as text, e.g. ``"24 Oct 2026"``; ``%-d`` is supported on every platform."""
    return ad.strftime(fmt.replace("%-d", str(ad.day)).replace("%-m", str(ad.month)))


@dataclass(frozen=True)
class HeaderDate:
    """A date for page and print headers. ``full`` renders as
    "शनिबार, कार्तिक ७, २०८३ · Kartik 7, 2083 BS · Sat 24 Oct 2026"."""

    ad_date: date
    bs_date: BSDate

    @property
    def ad(self) -> str:
        return format_ad(self.ad_date, "%a %-d %b %Y")

    @property
    def bs_en(self) -> str:
        return f"{format_bs(self.bs_date)} BS"

    @property
    def np(self) -> str:
        return format_bs(self.bs_date, "%A, %B %-d, %Y", "ne")

    @property
    def full(self) -> str:
        return " · ".join((self.np, self.bs_en, self.ad))


def header_date(ad: date | datetime | None = None) -> HeaderDate:
    ad = kathmandu_date(ad) if ad is not None else today_ad()
    return HeaderDate(ad, ad_to_bs(ad))
