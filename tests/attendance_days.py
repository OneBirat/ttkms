"""Attendance rows for payroll tests. Payroll does not pay a past working day without a record
(MonthSummary.not_marked), so a test about anything else first marks its people Present."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.core import bsdate
from app.modules.attendance import services
from app.modules.attendance.models import Record
from app.modules.payroll import ledgers


async def attend(db, employee, *months: tuple[int, int], skip=()) -> None:
    """Present on every working day of the BS ``months`` that has no record yet: from the
    joining date, before today. ``skip`` leaves those dates without a record."""
    today = services.today()
    for year, month in months:
        start, end = bsdate.bs_month_range(year, month)
        taken = set(
            await db.scalars(
                select(Record.date).where(
                    Record.employee_id == employee.id, Record.date.between(start, end)
                )
            )
        )
        day = max(start, employee.joined_ad)
        while day <= end and day < today:
            if not services.is_weekly_off(day) and day not in taken and day not in skip:
                db.add(
                    Record(
                        employee_id=employee.id,
                        date=day,
                        status="P",
                        overtime_hours=0,
                        branch_id=employee.branch_id,
                        source="manual",
                    )
                )
            day += timedelta(days=1)
    await db.flush()


async def attend_kept(db, employee, skip=()) -> None:
    """Every month payroll keeps (the running month and the five before it)."""
    await attend(db, employee, *ledgers.months_kept(), skip=skip)
