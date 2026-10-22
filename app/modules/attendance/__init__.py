"""Attendance module - placeholder.

The feat/attendance worktree builds this module and only touches app/modules/attendance/,
migrations/attendance/ and tests/attendance/. Put models in app/modules/attendance/models.py (schema
"attendance"), templates under app/modules/attendance/templates/attendance/, and register dashboard
widgets on the Module below.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.templating import render_placeholder

ROLES = {"admin", "manager", "store_keeper", "staff"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", name="attendance:index")
async def index(request: Request) -> Response:
    return render_placeholder(
        request, title="Attendance", subtitle="Daily attendance, late marks and leave"
    )


module = Module(
    name="attendance",
    title="Attendance",
    router=router,
    nav=[NavItem(label="Overview", path="/attendance", icon="clock", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Attendance")],
)
