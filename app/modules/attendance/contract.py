"""The real ``AttendanceSummary`` (app/contracts.py), registered when the attendance module
loads. Payroll calls it in-process; each call opens its own session.

``for_month``: a past month counts the whole month; the running month counts the days up to
today (Kathmandu), so payroll's "earned so far" and the advance room follow the days already
worked; a month that has not started counts nothing. Saturday (the weekly off) is counted in
``weekly_off`` whether or not the person came in; a Saturday mark (P / O) goes into
``saturday_days_worked`` / ``saturday_ot_hours`` only, never into present / overtime. Days
before the joining date (and after an inactive employee's leaving date) count for nothing.

``not_marked``: working days without a record BEFORE today, inside that period. They are
unpaid like absent days - computed here and nowhere else, never stored as ``A`` rows; today
and future days are never counted. ``days_after_leaving``: the counted days after an inactive
employee's leaving day - unpaid as well.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select

from app import contracts
from app.contracts import MonthSummary, TodayStatus
from app.core import bsdate
from app.core.models import Employee, EmployeeStatus
from app.db import SessionLocal
from app.modules.attendance import services
from app.modules.attendance.models import Record

#: Where the contract's own sessions come from (the test-suite shares the test session).
SESSION_FACTORY = SessionLocal

TODAY_STATUS: dict[str, TodayStatus] = {"P": "present", "O": "overtime", "A": "absent"}


def session():
    return SESSION_FACTORY()


def summarise(
    start: date,
    end: date,
    today: date,
    joined: date | None,
    records: Iterable,
    left: date | None = None,
) -> MonthSummary:
    """The month ``start..end`` as seen on ``today`` (pure; unit-tested). ``joined`` / ``left``
    bound the employee's active period (``left`` only for an inactive employee)."""
    records = list(records)
    days_in_month = (end - start).days + 1
    if start > today:
        upto, days_counted = start - timedelta(days=1), 0
    elif end > today:
        upto, days_counted = today, (today - start).days + 1
    else:
        upto, days_counted = end, days_in_month
    first = max(start, joined) if joined else start
    last = min(upto, left) if left else upto
    weekly_off = sum(
        1
        for i in range((last - first).days + 1)
        if services.is_weekly_off(first + timedelta(days=i))
    )
    # Not marked: working days without a record, before today, inside the active period.
    marked = {r.date for r in records}
    last_past = min(last, today - timedelta(days=1))
    not_marked = sum(
        1
        for i in range((last_past - first).days + 1)
        if not services.is_weekly_off(first + timedelta(days=i))
        and first + timedelta(days=i) not in marked
    )
    # After leaving: every counted day past the leaving day (Saturdays too) is unpaid.
    after_leaving = max(0, (upto - max(left, start - timedelta(days=1))).days) if left else 0
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
        not_marked=not_marked,
        days_after_leaving=after_leaving,
    )


def left_on(employee: Employee) -> date | None:
    """The last day of an inactive employee's active period (Kathmandu day of the
    deactivation); None while active."""
    if employee.status != EmployeeStatus.active and employee.deactivated_at is not None:
        return bsdate.kathmandu_date(employee.deactivated_at)
    return None


@dataclass(frozen=True)
class WhatIfMark:
    """A day's mark that is not stored (yet): :func:`summarise` only reads these three."""

    date: date
    status: str
    overtime_hours: int


async def month_if(
    db, employee: Employee, ad: date, status: str | None, hours: int
) -> tuple[MonthSummary, MonthSummary, Record | None]:
    """The BS month of ``ad`` for one employee as it is, and as it would be with that day's
    mark set to ``status`` / ``hours`` (``None`` = removed), plus the day's present record.
    Nothing is written."""
    bs = bsdate.ad_to_bs(ad)
    start, end = bsdate.bs_month_range(bs.year, bs.month)
    records = list(
        await db.scalars(
            select(Record).where(
                Record.employee_id == employee.id, Record.date >= start, Record.date <= end
            )
        )
    )
    current = next((r for r in records if r.date == ad), None)
    changed: list[Record | WhatIfMark] = [r for r in records if r.date != ad]
    if status is not None:
        changed.append(WhatIfMark(ad, status, hours))
    today = services.today()
    return (
        summarise(start, end, today, employee.joined_ad, records, left_on(employee)),
        summarise(start, end, today, employee.joined_ad, changed, left_on(employee)),
        current,
    )


class AttendanceSummaryService:
    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
        start, end = bsdate.bs_month_range(bs_year, bs_month)
        async with session() as db:
            employee = await db.get(Employee, employee_id)
            records = list(
                await db.scalars(
                    select(Record).where(
                        Record.employee_id == employee_id,
                        Record.date >= start,
                        Record.date <= end,
                    )
                )
            )
        joined = employee.joined_ad if employee else None
        left = left_on(employee) if employee else None
        return summarise(start, end, services.today(), joined, records, left)

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
