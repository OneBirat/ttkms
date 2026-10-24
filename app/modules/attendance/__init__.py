"""Attendance module.

UI-first pass: the Next.js screens under web/app/(app)/attendance run on mock data in
web/components/attendance/api.ts. This file registers what the shell needs today - the sidebar
entries and the "Attendance today" dashboard widget (with sample data) - and keeps the index
endpoint. The endpoints, the table and the payroll contract to implement after UI sign-off are
written down in API_NOTES.md next to this file.

Rules (decided 24 Oct 2026): a day's status is only P (present), O (overtime: present + whole
hours 1-12) or A (absent); no in/out times; weekly off is Saturday and shown as "-"; "not marked"
means no record yet. Paid days = P + O + weekly off.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ModuleStatusOut
from app.modules.admin.permissions import require_any_access

#: Access is per user (app.modules.admin.permissions), not per role: anyone with
#: ``mark_attendance`` (every preset, Staff included) sees the module and marks; the report needs
#: ``view_attendance_report`` (Manager and Admin presets, or switched on for a user).
MARK = "mark_attendance"
REPORT = "view_attendance_report"

router = APIRouter(dependencies=[Depends(require_any_access(MARK, REPORT))])


@router.get("", response_model=ModuleStatusOut, name="attendance:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="attendance", title="Attendance", status="coming_soon")


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
