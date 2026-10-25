"""Attendance module.

Tables in ``models.py`` (schema ``attendance``), endpoints in ``routes.py`` (API_NOTES.md),
marking rules in ``services.py``. This file registers the sidebar entries and the "Attendance
today" dashboard widget.

Rules (decided 24 Oct 2026): a day's status is only P (present), O (overtime: present + whole
hours 1-12) or A (absent); no in/out times; weekly off is Saturday and shown as "-"; "not marked"
means no record yet. Paid days = P + O + weekly off.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.core.models import Employee, EmployeeStatus
from app.core.modules import Module, NavItem, WidgetContext
from app.modules.attendance import contract, services
from app.modules.attendance.access import MARK, REPORT, scope_for
from app.modules.attendance.routes import router

#: Access is per user (app.modules.admin.permissions), not per role: anyone with
#: ``mark_attendance`` (every preset, Staff included) sees the module and marks; the report needs
#: ``view_attendance_report`` (Manager and Admin presets, or switched on for a user).
__all__ = ["MARK", "REPORT", "module", "router"]


# --------------------------------------------------------------------------- widgets

#: Names listed under "Not in yet" on the card.
NOT_IN_LIMIT = 8


async def today_figures(ctx: WidgetContext) -> dict[str, Any]:
    """Today's counts for the caller's branch (every branch with ``see_other_branches``):
    ``total`` active staff, ``present`` P, ``overtime`` O (+ ``overtime_hours``), ``absent`` A,
    ``not_marked`` without a record (0 on the weekly off: nobody needs a mark), ``weekly_off``
    true on Saturdays, ``not_in`` the absent / not-marked names, ``mark_path``."""
    scope = await scope_for(ctx.db, ctx.user, None)
    day = services.today()
    query = select(Employee).where(
        Employee.status == EmployeeStatus.active, Employee.joined_ad <= day
    )
    if scope.branch_id is not None:
        query = query.where(Employee.branch_id == scope.branch_id)
    employees = sorted(await ctx.db.scalars(query), key=lambda e: (e.full_name.lower(), e.id))
    records = await services.day_records(ctx.db, day, [e.id for e in employees])
    weekly_off = services.is_weekly_off(day)
    counts = {"P": 0, "O": 0, "A": 0, "N": 0}
    hours = 0
    not_in: list[dict[str, Any]] = []
    for e in employees:
        record = records.get(e.id)
        if record is None:
            if weekly_off:
                continue
            counts["N"] += 1
            not_in.append({"employee_id": e.id, "name": e.full_name, "status": "N"})
            continue
        counts[record.status] += 1
        hours += record.overtime_hours
        if record.status == "A":
            not_in.append({"employee_id": e.id, "name": e.full_name, "status": "A"})
    not_in.sort(key=lambda n: (n["status"] != "A", n["name"].lower()))
    return {
        "total": len(employees),
        "present": counts["P"],
        "overtime": counts["O"],
        "overtime_hours": hours,
        "absent": counts["A"],
        "not_marked": counts["N"],
        "weekly_off": weekly_off,
        "not_in": not_in[:NOT_IN_LIMIT],
        "mark_path": "/attendance/mark",
    }


async def attendance_today_widget(ctx: WidgetContext) -> dict[str, Any]:
    """The "Attendance today" card: segmented bar, Present / Overtime / Absent / Not marked
    counts, the "Not in yet" list and a Mark link (web/components/attendance/widgets)."""
    return {
        "kind": "attendance_today",
        "title": "Attendance today",
        "data": await today_figures(ctx),
    }


TODAY_COUNT_FIELDS = ("total", "present", "overtime", "overtime_hours", "absent", "not_marked")


async def attendance_today_counts(ctx: WidgetContext) -> dict[str, Any]:
    """Attendance's share of ``GET /api/today`` ``counts`` (``TodayCountsOut``): the same figures
    as the widget, for the dashboard stat row."""
    figures = await today_figures(ctx)
    return {key: figures[key] for key in TODAY_COUNT_FIELDS}


# Payroll reads attendance through app/contracts.py (AttendanceSummary).
contract.register()


module = Module(
    name="attendance",
    title="Attendance",
    router=router,
    nav=[
        NavItem(label="Mark attendance", path="/attendance/mark", icon="check", permission=MARK),
        NavItem(
            label="Attendance report", path="/attendance/report", icon="calendar", permission=REPORT
        ),
    ],
    dashboard_widgets=[attendance_today_widget],
    today_counts=attendance_today_counts,
)
