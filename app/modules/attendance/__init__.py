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

from app.core.modules import Module, NavItem, WidgetContext
from app.modules.attendance.access import MARK, REPORT
from app.modules.attendance.routes import router

#: Access is per user (app.modules.admin.permissions), not per role: anyone with
#: ``mark_attendance`` (every preset, Staff included) sees the module and marks; the report needs
#: ``view_attendance_report`` (Manager and Admin presets, or switched on for a user).
__all__ = ["MARK", "REPORT", "module", "router"]


# --------------------------------------------------------------------------- widgets

#: Sample figures for the dashboard card until attendance.records exists: 14 staff, 9 present,
#: 2 with overtime (3 h in total), 2 absent, 1 not marked yet.
SAMPLE_TODAY: dict[str, Any] = {
    "total": 14,
    "present": 9,
    "overtime": 2,
    "overtime_hours": 3,
    "absent": 2,
    "not_marked": 1,
    "not_in": [
        {"employee_id": 13, "name": "Sita Thapa", "status": "A"},
        {"employee_id": 2, "name": "Ramesh K.C.", "status": "A"},
        {"employee_id": 21, "name": "Kiran Lama", "status": "N"},
    ],
    "mark_path": "/attendance/mark",
}


async def attendance_today_widget(ctx: WidgetContext) -> dict[str, Any]:
    """The "Attendance today" card: segmented bar, Present / Overtime / Absent / Not marked
    counts, the "Not in yet" list and a Mark link (web/components/attendance/widgets)."""
    return {"kind": "attendance_today", "title": "Attendance today", "data": dict(SAMPLE_TODAY)}


TODAY_COUNT_FIELDS = ("total", "present", "overtime", "overtime_hours", "absent", "not_marked")


async def attendance_today_counts(ctx: WidgetContext) -> dict[str, Any]:
    """Attendance's share of ``GET /api/today`` ``counts`` (``TodayCountsOut``): the same figures
    as the widget, for the dashboard stat row. Sample data until ``attendance.records`` exists;
    the real version counts today's records of the caller's branch(es)."""
    return {key: SAMPLE_TODAY[key] for key in TODAY_COUNT_FIELDS}


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
