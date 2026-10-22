"""Attendance module.

UI-only session: the Next.js screens under web/app/(app)/attendance run on mock data in
web/components/attendance/api.ts. This file registers what the shell needs today - the sidebar
entries and the two dashboard widgets (with sample data) - and keeps the index endpoint.

TODO (backend session): models in app/modules/attendance/models.py (schema "attendance",
table records: employee_id, date, status, in_time, out_time, note, marked_by, updated_at,
unique (employee_id, date)), the endpoints listed in web/components/attendance/api.ts, real
widget data, and `register_attendance_summary(...)` replacing the fake in app/contracts.py.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ModuleStatusOut

#: Who marks attendance and reads the report; staff and store keepers have no attendance screens
#: yet, so the whole module (sidebar entries and /api/attendance/*) is limited to these roles.
ROLES = {"admin", "manager"}
MARKING_ROLES = ROLES

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="attendance:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="attendance", title="Attendance", status="coming_soon")


# --------------------------------------------------------------------------- widgets

#: Sample figures matching docs/design/Main.dc.html until attendance.records exists.
SAMPLE_TODAY: dict[str, Any] = {
    "total": 14,
    "on_time": 9,
    "late": 2,
    "half_day": 0,
    "leave": 1,
    "absent": 2,
    "not_marked": 0,
    "not_in": [
        {"employee_id": 13, "name": "Sita Thapa", "status": "absent"},
        {"employee_id": 2, "name": "Ramesh K.C.", "status": "absent"},
    ],
    "mark_path": "/attendance/mark",
}


async def staff_present_widget(ctx: WidgetContext) -> dict[str, Any]:
    """Stat card: "Staff present today 11 / 14 · 2 late · 1 on leave"."""
    today = SAMPLE_TODAY
    return {
        "kind": "attendance_stat",
        "title": "Staff present today",
        "data": {
            "present": today["on_time"] + today["late"] + today["half_day"],
            "total": today["total"],
            "late": today["late"],
            "leave": today["leave"],
            "href": "/attendance/report",
        },
    }


async def attendance_today_widget(ctx: WidgetContext) -> dict[str, Any]:
    """Segmented bar, counts, "Not in yet" list and a Mark link."""
    return {"kind": "attendance_today", "title": "Attendance today", "data": dict(SAMPLE_TODAY)}


module = Module(
    name="attendance",
    title="Attendance",
    router=router,
    nav=[
        NavItem(
            label="Mark attendance", path="/attendance/mark", icon="check", roles=set(MARKING_ROLES)
        ),
        NavItem(
            label="Attendance report",
            path="/attendance/report",
            icon="calendar",
            roles=set(MARKING_ROLES),
        ),
    ],
    dashboard_widgets=[staff_present_widget, attendance_today_widget],
)
