"""The real AttendanceSummary: full-month figures for past months, "so far" up to today for the
running month, nothing for future months; Saturday work counted apart; today() for payroll's
Today column."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app import contracts
from app.core import bsdate
from app.modules.attendance import contract, services
from app.modules.attendance.models import Record

pytestmark = pytest.mark.anyio

# Kartik 2083 = 2026-10-18 .. 2026-11-16 (30 days); Saturdays 24, 31 Oct and 7, 14 Nov.
START, END = bsdate.bs_month_range(2083, 7)
SATURDAYS = [date(2026, 10, 24), date(2026, 10, 31), date(2026, 11, 7), date(2026, 11, 14)]


def _rec(day, status="P", hours=0, employee_id=1):
    return Record(
        employee_id=employee_id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=1,
        source="manual",
    )


RECORDS = [
    _rec(date(2026, 10, 19)),
    _rec(date(2026, 10, 20), "O", 2),
    _rec(date(2026, 10, 21), "A"),
    _rec(date(2026, 10, 24), "O", 5),  # Saturday worked
    _rec(date(2026, 10, 31), "P"),  # Saturday worked
    _rec(date(2026, 11, 2), "A"),
]


def test_past_month_counts_everything():
    s = contract.summarise(START, END, date(2026, 12, 1), date(2026, 1, 1), RECORDS)
    assert (END - START).days + 1 == 30 and [
        d for d in SATURDAYS if bsdate.weekday_index(d) == 6
    ] == SATURDAYS
    assert s == contracts.MonthSummary(
        days_in_month=30,
        present=1,
        overtime_days=1,
        overtime_hours=2,
        absent=2,
        weekly_off=4,
        paid_days=6,
        days_counted=30,
        saturday_days_worked=2,
        saturday_ot_hours=5,
    )


def test_running_month_counts_so_far():
    s = contract.summarise(START, END, date(2026, 10, 25), date(2026, 1, 1), RECORDS)
    assert s.days_counted == 8  # Kartik 8
    assert (s.present, s.overtime_days, s.absent, s.weekly_off) == (1, 1, 1, 1)
    assert (s.saturday_days_worked, s.saturday_ot_hours) == (1, 5)


def test_future_month_and_joining_mid_month():
    future = contract.summarise(START, END, date(2026, 10, 1), date(2026, 1, 1), RECORDS)
    assert (future.days_counted, future.weekly_off, future.present, future.absent) == (0, 0, 0, 0)
    joined = contract.summarise(START, END, date(2026, 12, 1), date(2026, 11, 1), [])
    assert joined.weekly_off == 2 and joined.days_counted == 30


async def test_for_month_and_today_from_the_database(db, world, monkeypatch):
    anita, bikash = world.people["Anita"], world.people["Bikash"]
    for r in RECORDS:
        r.employee_id, r.branch_id = anita.id, anita.branch_id
    db.add_all(RECORDS)
    await db.flush()
    monkeypatch.setattr(services, "now", lambda: datetime(2026, 11, 20, 6, tzinfo=UTC))
    summary = contracts.get_attendance_summary()
    assert isinstance(summary, contract.AttendanceSummaryService)
    s = await summary.for_month(anita.id, 2083, 7)
    assert (s.absent, s.saturday_days_worked, s.days_counted) == (2, 2, 30)
    today = await summary.today([anita.id, bikash.id], date(2026, 10, 20))
    assert today == {anita.id: "overtime", bikash.id: "not_marked"}
    saturday = await summary.today([anita.id, bikash.id], date(2026, 10, 24))
    assert saturday == {anita.id: "overtime", bikash.id: "weekly_off"}
    assert await summary.today([], date(2026, 10, 24)) == {}
    monkeypatch.setattr(
        services, "now", lambda: datetime.combine(date(2026, 10, 21), datetime.min.time(), UTC)
    )
    assert (await summary.today([anita.id]))[anita.id] == "absent"
    assert START + timedelta(days=29) == END
