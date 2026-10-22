"""Attendance module - placeholder.

The feat/attendance worktree builds this module and only touches app/modules/attendance/,
migrations/attendance/, tests/attendance/ and its pages under web/. Put models in
app/modules/attendance/models.py (schema "attendance"), API routes on the router below (mounted at
/api/attendance), and register dashboard widgets on the Module.
"""

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut

ROLES = {"admin", "manager", "store_keeper", "staff"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="attendance:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="attendance", title="Attendance", status="coming_soon")


module = Module(
    name="attendance",
    title="Attendance",
    router=router,
    nav=[NavItem(label="Overview", path="/attendance", icon="calendar", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Attendance", "Daily attendance, late marks and leave")],
)
