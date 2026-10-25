"""The real ``AttendanceSummary`` (app/contracts.py), registered when the attendance module
loads. Payroll calls it in-process; each call opens its own session.

``for_month``: a past month counts the whole month; the running month counts the days up to
today (Kathmandu), so payroll's "earned so far" and the advance room follow the days already
worked; a month that has not started counts nothing. Saturday (the weekly off) is counted in
``weekly_off`` whether or not the person came in; a Saturday mark (P / O) goes into
``saturday_days_worked`` / ``saturday_ot_hours`` only, never into present / overtime. Days
before the joining date count for nothing.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import select

from app import contracts
from app.contracts import MonthSummary, TodayStatus
from app.core import bsdate
from app.core.models import Employee
from app.db import SessionLocal
from app.modules.attendance import services
from app.modules.attendance.models import Record

#: Where the contract's own sessions come from (the test-suite shares the test session).
SESSION_FACTORY = SessionLocal

TODAY_STATUS: dict[str, TodayStatus] = {"P": "present", "O": "overtime", "A": "absent"}


def session():
    return SESSION_FACTORY()


def summarise(
    start: date, end: date, today: date, joined: date | None, records: Iterable[Record]
) -> MonthSummary:
    """The month ``start..end`` as seen on ``today`` (pure; unit-tested)."""
    days_in_month = (end - start).days + 1
    if start > today:
        upto, days_counted = start - timedelta(days=1), 0
    elif end > today:
        upto, days_counted = today, (today - start).days + 1
    else:
        upto, days_counted = end, days_in_month
    first = max(start, joined) if joined else start
    weekly_off = sum(
        1
        for i in range((upto - first).days + 1)
        if services.is_weekly_off(first + timedelta(days=i))
    )
    present = overtime_days = overtime_hours = absent = sat_days = sat_hours = 0
    for r in records:
        if not start <= r.date <= upto:
            continue
        if services.is_weekly_off(r.date):
            if r.status in ("P", "O"):
                sat_days += 1
                sat_hours += r.overtime_hours
        elif r.status == "P":
            present += 1
        elif r.status == "O":
            overtime_days += 1
            overtime_hours += r.overtime_hours
        elif r.status == "A":
            absent += 1
    return MonthSummary(
        days_in_month=days_in_month,
        present=present,
        overtime_days=overtime_days,
        overtime_hours=overtime_hours,
        absent=absent,
        weekly_off=weekly_off,
        paid_days=present + overtime_days + weekly_off,
        days_counted=days_counted,
        saturday_days_worked=sat_days,
        saturday_ot_hours=sat_hours,
    )


class AttendanceSummaryService:
    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
        start, end = bsdate.bs_month_range(bs_year, bs_month)
        async with session() as db:
            joined = await db.scalar(select(Employee.joined_ad).where(Employee.id == employee_id))
            records = list(
                await db.scalars(
                    select(Record).where(
                        Record.employee_id == employee_id,
                        Record.date >= start,
                        Record.date <= end,
                    )
                )
            )
        return summarise(start, end, services.today(), joined, records)

    async def today(
        self, employee_ids: Iterable[int], day: date | None = None
    ) -> dict[int, TodayStatus]:
        day = day or services.today()
        ids = list(employee_ids)
        if not ids:
            return {}
        async with session() as db:
            records = await services.day_records(db, day, ids)
        empty: TodayStatus = "weekly_off" if services.is_weekly_off(day) else "not_marked"
        return {i: TODAY_STATUS[records[i].status] if i in records else empty for i in ids}


ATTENDANCE_SUMMARY = AttendanceSummaryService()


def register() -> None:
    contracts.register_attendance_summary(ATTENDANCE_SUMMARY)
