"""Bikram Sambat calendar tests.

The table under test is web/lib/bs/calendar-data.json (generated from the nepali-datetime package
by scripts/gen_bs_calendar.py). The same fixtures drive the node tests in web/lib/bs.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from app.core import bsdate
from app.core.bsdate import BSDate

FIXTURES = Path(bsdate.DATA_PATH).parent / "fixtures"
OFFICIAL = json.loads((FIXTURES / "official-2082-2083.json").read_text(encoding="utf-8"))

# Known pairs from published calendars: new-year days plus the dates the design uses
# (20 Oct 2026 = Kartik 3, 24 Oct 2026 = Kartik 7; Ashwin 2083 = 17 Sep - 17 Oct 2026).
KNOWN_PAIRS = [
    (BSDate(2000, 9, 17), date(1944, 1, 1)),
    (BSDate(2070, 1, 1), date(2013, 4, 14)),
    (BSDate(2072, 1, 1), date(2015, 4, 14)),
    (BSDate(2072, 1, 12), date(2015, 4, 25)),
    (BSDate(2073, 1, 1), date(2016, 4, 13)),
    (BSDate(2075, 1, 1), date(2018, 4, 14)),
    (BSDate(2077, 1, 1), date(2020, 4, 13)),
    (BSDate(2080, 1, 1), date(2023, 4, 14)),
    (BSDate(2081, 1, 1), date(2024, 4, 13)),
    (BSDate(2082, 1, 1), date(2025, 4, 14)),
    (BSDate(2083, 6, 1), date(2026, 9, 17)),
    (BSDate(2083, 6, 31), date(2026, 10, 17)),
    (BSDate(2083, 7, 1), date(2026, 10, 18)),
    (BSDate(2083, 7, 3), date(2026, 10, 20)),
    (BSDate(2083, 7, 7), date(2026, 10, 24)),
    (BSDate(2100, 1, 1), date(2043, 4, 14)),
]


# ------------------------------------------------------------------------------- the table


def test_table_covers_the_required_years_and_is_consistent():
    lo, hi = bsdate.year_range()
    assert lo <= 2070 and hi >= 2100
    cal = bsdate.calendar()
    for year in range(lo, hi):
        assert sum(cal.months[year]) == (cal.new_year[year + 1] - cal.new_year[year]).days
        assert all(28 <= m <= 32 for m in cal.months[year])


def test_table_matches_the_nepali_datetime_package():
    """New-year anchors and month lengths equal the package the JSON was generated from."""
    nd = pytest.importorskip("nepali_datetime")
    cal = bsdate.calendar()
    assert (cal.first_year, cal.last_year) == (nd.MINYEAR, nd.MAXYEAR)
    for year in range(cal.first_year, cal.last_year + 1):
        if year in cal.overridden:
            continue
        assert cal.new_year[year] == nd.date(year, 1, 1).to_datetime_date(), year
        assert list(cal.months[year]) == [nd._days_in_month(year, m) for m in range(1, 13)], year


def test_generated_json_is_current():
    from scripts.gen_bs_calendar import build_table, render

    pytest.importorskip("nepali_datetime")
    assert bsdate.DATA_PATH.read_text(encoding="utf-8") == render(build_table())


@pytest.mark.parametrize("year", sorted(OFFICIAL["years"]))
def test_official_calendar_fixture(year):
    """Official Nepali Patro dates for the fixture years (hand-checked, see docs/bs-calendar.md)."""
    entry = OFFICIAL["years"][year]
    y = int(year)
    assert [bsdate.days_in_month(y, m) for m in range(1, 13)] == entry["months"]
    for month, first in enumerate(entry["month_first_days_ad"], start=1):
        assert bsdate.bs_to_ad(BSDate(y, month, 1)).isoformat() == first
        assert bsdate.ad_to_bs(date.fromisoformat(first)) == BSDate(y, month, 1)


@pytest.mark.parametrize("pair", OFFICIAL["known_pairs"], ids=lambda p: p["bs"])
def test_official_known_pairs(pair):
    bs = BSDate.parse(pair["bs"])
    ad = date.fromisoformat(pair["ad"])
    assert bsdate.bs_to_ad(bs) == ad and bsdate.ad_to_bs(ad) == bs


def test_overrides_win_over_the_package_table(tmp_path, monkeypatch):
    cal = bsdate.calendar()
    year = 2090
    months = list(cal.months[year])
    shorter = months.index(max(months))
    longer = months.index(min(months))
    months[shorter] -= 1
    months[longer] += 1  # same year length: the next year's new year is unchanged
    overrides = tmp_path / "calendar-overrides.json"
    overrides.write_text(
        json.dumps(
            {
                "years": {
                    str(year): {"months": months, "new_year_ad": cal.new_year[year].isoformat()}
                }
            }
        )
    )
    patched = bsdate.load_calendar(bsdate.DATA_PATH, overrides)
    assert patched.overridden == {year}
    assert list(patched.months[year]) == months
    assert patched.months[year - 1] == cal.months[year - 1]
    monkeypatch.setattr(bsdate, "calendar", lambda: patched)
    assert bsdate.days_in_month(year, shorter + 1) == months[shorter]
    assert bsdate.bs_to_ad(BSDate(year, 2, 1)) == cal.new_year[year] + timedelta(days=months[0])

    # An override that changes the year's length without moving the next new year is refused.
    months[longer] -= 1
    overrides.write_text(
        json.dumps(
            {
                "years": {
                    str(year): {"months": months, "new_year_ad": cal.new_year[year].isoformat()}
                }
            }
        )
    )
    with pytest.raises(ValueError, match="calendar-overrides.json: BS 2090 ends on"):
        bsdate.load_calendar(bsdate.DATA_PATH, overrides)

    # Malformed entries are refused too.
    overrides.write_text(json.dumps({"years": {"2090": {"months": [30] * 11}}}))
    with pytest.raises(ValueError, match="needs 'months' and 'new_year_ad'"):
        bsdate.load_calendar(bsdate.DATA_PATH, overrides)


def test_missing_overrides_file_is_fine(tmp_path):
    cal = bsdate.load_calendar(bsdate.DATA_PATH, tmp_path / "none.json")
    assert cal.overridden == frozenset() and cal.months == bsdate.calendar().months


# ------------------------------------------------------------------------------ conversions


@pytest.mark.parametrize(("bs", "ad"), KNOWN_PAIRS, ids=[str(p[0]) for p in KNOWN_PAIRS])
def test_known_pairs(bs, ad):
    assert bsdate.bs_to_ad(bs) == ad
    assert bsdate.ad_to_bs(ad) == bs


def test_round_trip_every_day_2013_04_14_to_2043_04_13():
    """Every AD day from 2013-04-14 (1 Baisakh 2070) to 2043-04-13 (30 Chaitra 2099) converts to
    BS and back, consecutive days stay consecutive, and the months add up to each year's length."""
    ad = date(2013, 4, 14)
    last = date(2043, 4, 13)
    previous: BSDate | None = None
    while ad <= last:
        bs = bsdate.ad_to_bs(ad)
        assert bsdate.bs_to_ad(bs) == ad
        if previous is not None:
            if bs.day != 1:
                assert bs == BSDate(previous.year, previous.month, previous.day + 1)
            elif bs.month != 1:
                assert previous == BSDate(
                    bs.year, bs.month - 1, bsdate.days_in_month(bs.year, bs.month - 1)
                )
            else:
                assert previous == BSDate(bs.year - 1, 12, bsdate.days_in_month(bs.year - 1, 12))
        previous = bs
        ad += timedelta(days=1)
    assert bsdate.ad_to_bs(last) == BSDate(2099, 12, 30)
    for year in range(2070, 2100):
        assert (
            bsdate.days_in_year(year)
            == (bsdate.bs_to_ad(BSDate(year + 1, 1, 1)) - bsdate.bs_to_ad(BSDate(year, 1, 1))).days
        )


def test_out_of_range_and_invalid_days_are_rejected():
    lo, hi = bsdate.year_range()
    with pytest.raises(ValueError):
        bsdate.validate(BSDate(2083, 7, bsdate.days_in_month(2083, 7) + 1))
    with pytest.raises(ValueError):
        bsdate.days_in_month(lo - 1, 1)
    with pytest.raises(ValueError):
        bsdate.ad_to_bs(bsdate.calendar().new_year[lo] - timedelta(days=1))
    with pytest.raises(ValueError):
        bsdate.ad_to_bs(bsdate.calendar().end_ad)
    assert bsdate.ad_to_bs(bsdate.calendar().end_ad - timedelta(days=1)) == BSDate(
        hi, 12, bsdate.days_in_month(hi, 12)
    )


def test_parse_bs():
    assert bsdate.parse_bs("2083-07-07") == BSDate(2083, 7, 7)
    assert BSDate.parse(" 2083-7-7 ") == BSDate(2083, 7, 7)
    assert bsdate.parse_bs(BSDate(2083, 7, 7)) == BSDate(2083, 7, 7)
    for bad in ("2083/07/04", "2083-13-01", "2083-01-40", "2083-07-31", "abc"):
        with pytest.raises(ValueError):
            bsdate.parse_bs(bad)


def test_pydantic_type_validates_and_serialises():
    from pydantic import BaseModel, ValidationError

    class Model(BaseModel):
        d: BSDate

    assert Model(d="2083-07-07").d == BSDate(2083, 7, 7)
    assert Model(d=BSDate(2083, 7, 7)).model_dump() == {"d": "2083-07-07"}
    assert Model.model_validate_json('{"d": "2083-7-7"}').model_dump_json() == '{"d":"2083-07-07"}'
    for bad in ("2083-07-31", "2083-13-01", "yesterday", 20830707):
        with pytest.raises(ValidationError):
            Model(d=bad)


# ------------------------------------------------------------------------------------- time


def test_today_follows_kathmandu_not_utc():
    # 24 Oct 2026 23:59 in Kathmandu is 18:14 UTC; two minutes later it is 25 Oct (Kartik 8).
    assert bsdate.today_bs(datetime(2026, 10, 24, 18, 14, tzinfo=UTC)) == BSDate(2083, 7, 7)
    assert bsdate.today_bs(datetime(2026, 10, 24, 18, 16, tzinfo=UTC)) == BSDate(2083, 7, 8)
    assert bsdate.today_ad(datetime(2026, 10, 24, 18, 16, tzinfo=UTC)) == date(2026, 10, 25)
    # Naive datetimes are UTC.
    assert bsdate.ad_to_bs(datetime(2026, 10, 24, 18, 16)) == BSDate(2083, 7, 8)
    assert (
        bsdate.now_kathmandu(datetime(2026, 10, 24, 18, 16, tzinfo=UTC)).isoformat()
        == "2026-10-25T00:01:00+05:45"
    )
    assert 2080 <= bsdate.today_bs().year <= 2100


def test_day_bounds_are_the_kathmandu_day_in_utc():
    start, end = bsdate.day_bounds(date(2026, 10, 25))
    assert start == datetime(2026, 10, 24, 18, 15, tzinfo=UTC)
    assert end == datetime(2026, 10, 25, 18, 15, tzinfo=UTC)
    assert bsdate.kathmandu_date(start) == date(2026, 10, 25)
    assert bsdate.kathmandu_date(start - timedelta(minutes=1)) == date(2026, 10, 24)
    assert bsdate.kathmandu_date(end - timedelta(minutes=1)) == date(2026, 10, 25)
    assert bsdate.kathmandu_date(end) == date(2026, 10, 26)


# ------------------------------------------------------------------------- months and years


def test_bs_month_range():
    assert bsdate.bs_month_range(2083, 7) == (date(2026, 10, 18), date(2026, 11, 16))
    assert bsdate.bs_month_range(2083, 6) == (date(2026, 9, 17), date(2026, 10, 17))
    assert bsdate.bs_month_range(2083, 12) == (date(2027, 3, 15), date(2027, 4, 13))
    assert bsdate.shift_month(2083, 1, -1) == (2082, 12) and bsdate.shift_month(2083, 12, 1) == (
        2084,
        1,
    )


def test_fiscal_year_runs_shrawan_to_ashadh():
    assert bsdate.fiscal_year(BSDate(2083, 4, 1)).label == "2083/84"
    assert bsdate.fiscal_year(BSDate(2083, 3, 32)).label == "2082/83"
    assert bsdate.fiscal_year(BSDate(2083, 7, 7)).label == "2083/84"
    fy = bsdate.fiscal_year(BSDate(2084, 2, 1))
    assert fy.start == BSDate(2083, 4, 1) and fy.end == BSDate(2084, 3, 32)
    assert bsdate.fiscal_year(BSDate(2099, 12, 1)).label == "2099/00"


# ------------------------------------------------------------------------------- names, text


def test_month_and_weekday_names():
    assert bsdate.bs_month_name(7) == "Kartik" and bsdate.bs_month_name(7, "ne") == "कार्तिक"
    assert bsdate.bs_month_name(1) == "Baisakh" and bsdate.bs_month_name(12) == "Chaitra"
    with pytest.raises(ValueError):
        bsdate.bs_month_name(13)
    sunday = date(2026, 10, 18)
    assert [bsdate.weekday_initial(sunday + timedelta(days=i)) for i in range(7)] == list(
        "आ सो मं बु बि शु श".split()
    )
    assert bsdate.weekday_name(date(2026, 10, 20), "ne") == "मंगलबार"
    assert bsdate.weekday_name(date(2026, 10, 20)) == "Tuesday"
    assert (
        bsdate.weekday_name(BSDate(2083, 7, 7)) == "Saturday"
        and BSDate(2083, 7, 7).weekday == bsdate.SATURDAY
    )


def test_nepali_digits():
    assert bsdate.to_nepali_digits("2083-07-07") == "२०८३-०७-०७"
    assert bsdate.to_nepali_digits(4) == "४"


def test_format_bs():
    bs = BSDate(2083, 7, 7)
    assert bs.isoformat() == "2083-07-07" and str(bs) == "2083-07-07"
    assert bs.format() == "Kartik 7, 2083"
    assert bs.format(lang="ne") == "कार्तिक ७, २०८३"
    assert bsdate.format_bs(bs, "%Y-%m-%d") == "2083-07-07"
    assert bsdate.format_bs(bs, "%-d %b %Y") == "7 Kar 2083"
    assert bsdate.format_bs(bs, "%A, %B %-d, %Y") == "Saturday, Kartik 7, 2083"
    assert bsdate.format_bs(bs, "%a %-d/%-m %%") == "Sat 7/7 %"
    assert bsdate.format_bs(bs, "%A, %B %-d", "ne") == "शनिबार, कार्तिक ७"
    assert bsdate.format_bs(bs, "%a %d", "ne") == "शनि ०७"
    assert bsdate.format_ad(date(2026, 10, 24)) == "24 Oct 2026"
    assert BSDate(2083, 7, 4) < BSDate(2083, 8, 1)


def test_header_date():
    header = bsdate.header_date(date(2026, 10, 24))
    assert header.full == "शनिबार, कार्तिक ७, २०८३ · Kartik 7, 2083 BS · Sat 24 Oct 2026"
    assert header.np == "शनिबार, कार्तिक ७, २०८३" and header.bs_en == "Kartik 7, 2083 BS"
    # Timestamps are taken on the Kathmandu day.
    assert bsdate.header_date(datetime(2026, 10, 24, 18, 16, tzinfo=UTC)).bs_date == BSDate(
        2083, 7, 8
    )
