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

Public holidays (holidays.py) of the employee's branch are applied here, at read time: a paid
holiday without a mark is a paid day (``holidays``), never not marked, and an A mark on it is
no absence; an unpaid holiday without a mark is ``unpaid_holidays``. Working on a holiday is
P / O as usual (the overtime hours are paid at the overtime rate).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select

from app import contracts
from app.contracts import MonthSummary, TodayStatus
from app.core import bsdate
from app.core.models import Employee, EmployeeStatus
from app.db import SessionLocal
from app.modules.attendance import holidays as holiday_service
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
    holidays: Mapping[date, bool] | None = None,
) -> MonthSummary:
    """The month ``start..end`` as seen on ``today`` (pure; unit-tested). ``joined`` / ``left``
    bound the employee's active period (``left`` only for an inactive employee). ``holidays``:
    the public holidays of the employee's branch, date -> is_paid."""
    records = list(records)
    holidays = holidays or {}
    days_in_month = (end - start).days + 1
    if start > today:
        upto, days_counted = start - timedelta(days=1), 0
    elif end > today:
        upto, days_counted = today, (today - start).days + 1
    else:
        upto, days_counted = end, days_in_month
    first = max(start, joined) if joined else start
    last = min(upto, left) if left else upto
    active = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    weekly_off = sum(1 for day in active if services.is_weekly_off(day))
    by_day = {r.date: r for r in records}
    # Not marked: working days without a record, before today, inside the active period. A
    # public holiday is never "not marked".
    not_marked = sum(
        1
        for day in active
        if day < today
        and not services.is_weekly_off(day)
        and day not in by_day
        and day not in holidays
    )
    # Public holidays on working days: paid ones count as paid days unless the person worked
    # (P / O are counted as such); an A mark on a paid holiday is not an absence. Unpaid ones
    # without a mark cost the day.
    paid_holidays = unpaid_holidays = 0
    forgiven: set[date] = set()
    for day in active:
        if day not in holidays or services.is_weekly_off(day):
            continue
        record = by_day.get(day)
        if holidays[day]:
            if record is None or record.status == "A":
                paid_holidays += 1
                if record is not None:
                    forgiven.add(day)
        elif record is None:
            unpaid_holidays += 1
    # After leaving: every counted day past the leaving day (Saturdays too) is unpaid.
    after_leaving = max(0, (upto - max(left, start - timedelta(days=1))).days) if left else 0
    present = overtime_days = overtime_hours = sat_days = sat_hours = 0
    absent_dates: list[date] = []
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
        elif r.status == "A" and r.date not in forgiven:
            absent_dates.append(r.date)
    return MonthSummary(
        days_in_month=days_in_month,
        present=present,
        overtime_days=overtime_days,
        overtime_hours=overtime_hours,
        absent=len(absent_dates),
        weekly_off=weekly_off,
        paid_days=present + overtime_days + weekly_off + paid_holidays,
        days_counted=days_counted,
        saturday_days_worked=sat_days,
        saturday_ot_hours=sat_hours,
        not_marked=not_marked,
        days_after_leaving=after_leaving,
        holidays=paid_holidays,
        unpaid_holidays=unpaid_holidays,
        absent_dates=tuple(sorted(absent_dates)),
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
    off = holiday_service.paid_map(
        await holiday_service.for_branch(db, employee.branch_id, start, end)
    )
    return (
        summarise(start, end, today, employee.joined_ad, records, left_on(employee), off),
        summarise(start, end, today, employee.joined_ad, changed, left_on(employee), off),
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
            # The holidays of the employee's (current) branch.
            off = holiday_service.paid_map(
                await holiday_service.for_branch(
                    db, employee.branch_id if employee else None, start, end
                )
            )
        joined = employee.joined_ad if employee else None
        left = left_on(employee) if employee else None
        return summarise(start, end, services.today(), joined, records, left, off)

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
