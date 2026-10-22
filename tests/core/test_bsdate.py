"""Bikram Sambat calendar tests.

The conversion tests need the month table ported from the vendor date-picker
(app/core/bs_calendar_data.py) and are skipped until it exists.
"""

from datetime import date, timedelta

import pytest

from app.core import bsdate
from app.core.bsdate import BSDate

needs_table = pytest.mark.skipif(
    not bsdate.is_available(),
    reason="BS month table not ported yet (app/core/bs_calendar_data.py missing)",
)

# Known BS <-> AD pairs from published calendars (new-year days and well-known dates). The pair
# for 2083-07-04 comes from the project brief's header example (Tue 20 Oct 2026).
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
    (BSDate(2083, 7, 4), date(2026, 10, 20)),
]


def test_devanagari_digits():
    assert bsdate.to_devanagari_digits("2083-07-04") == "२०८३-०७-०४"
    assert bsdate.to_devanagari_digits(4) == "४"


def test_weekday_initials_and_names():
    sunday = date(2026, 10, 18)
    assert bsdate.weekday_initial(sunday) == "आ"
    assert [bsdate.weekday_initial(sunday + timedelta(days=i)) for i in range(7)] == list(
        "आ सो मं बु बि शु श".split()
    )
    assert bsdate.weekday_name(date(2026, 10, 20), nepali=True) == "मंगलबार"
    assert bsdate.weekday_name(date(2026, 10, 20)) == "Tuesday"


def test_month_names():
    assert bsdate.month_name(7) == "Kartik"
    assert bsdate.month_name(7, nepali=True) == "कार्तिक"
    assert bsdate.month_name(1) == "Baishakh" and bsdate.month_name(12) == "Chaitra"
    with pytest.raises(ValueError):
        bsdate.month_name(13)


def test_bsdate_format_and_iso():
    bs = BSDate(2083, 7, 4)
    assert bs.isoformat() == "2083-07-04" and str(bs) == "2083-07-04"
    assert bs.format() == "Kartik 4, 2083"
    assert bs.format(nepali=True) == "कार्तिक ४, २०८३"
    assert BSDate(2083, 7, 4) < BSDate(2083, 8, 1)


def test_parse_bs_shape():
    assert bsdate.parse_bs("2083-07-04") == BSDate(2083, 7, 4)
    assert BSDate.parse(" 2083-7-4 ") == BSDate(2083, 7, 4)
    for bad in ("2083/07/04", "2083-13-01", "2083-01-40", "abc"):
        with pytest.raises(ValueError):
            bsdate.parse_bs(bad)


def test_header_date_without_table_falls_back_to_ad(monkeypatch):
    monkeypatch.setattr(
        bsdate, "ad_to_bs", lambda ad: (_ for _ in ()).throw(bsdate.BSCalendarUnavailable())
    )
    header = bsdate.header_date(date(2026, 10, 20))
    assert not header.available
    assert header.full == "Tue 20 Oct 2026"
    assert header.np == "" and header.bs_en == ""


def test_header_date_full_format():
    header = bsdate.HeaderDate(date(2026, 10, 20), BSDate(2083, 7, 4))
    assert header.full == "मंगलबार, कार्तिक ४, २०८३ · Kartik 4, 2083 BS · Tue 20 Oct 2026"


@needs_table
def test_anchor():
    assert bsdate.bs_to_ad(BSDate(2000, 9, 17)) == date(1944, 1, 1)
    assert bsdate.ad_to_bs(date(1944, 1, 1)) == BSDate(2000, 9, 17)


@needs_table
@pytest.mark.parametrize(("bs", "ad"), KNOWN_PAIRS, ids=[str(p[0]) for p in KNOWN_PAIRS])
def test_known_pairs(bs, ad):
    assert bsdate.bs_to_ad(bs) == ad
    assert bsdate.ad_to_bs(ad) == bs


@needs_table
def test_round_trip_every_day_2070_to_2090():
    """Every BS day from 2070-01-01 to 2090-12-end converts to AD and back, and consecutive BS
    days are consecutive AD days."""
    previous_ad = None
    count = 0
    for year in range(2070, 2091):
        for month in range(1, 13):
            for day in range(1, bsdate.days_in_month(year, month) + 1):
                bs = BSDate(year, month, day)
                ad = bsdate.bs_to_ad(bs)
                assert bsdate.ad_to_bs(ad) == bs
                if previous_ad is not None:
                    assert ad - previous_ad == timedelta(days=1), (bs, ad, previous_ad)
                previous_ad = ad
                count += 1
    assert count > 21 * 364


@needs_table
def test_table_covers_1970_to_2099_and_invalid_days_are_rejected():
    lo, hi = bsdate.year_range()
    assert lo <= 1970 and hi >= 2099
    with pytest.raises(ValueError):
        bsdate.validate(BSDate(2083, 7, bsdate.days_in_month(2083, 7) + 1))
    with pytest.raises(ValueError):
        bsdate.days_in_month(1900, 1)


@needs_table
def test_today_bs_is_in_range():
    today = bsdate.today_bs()
    assert 2080 <= today.year <= 2099
