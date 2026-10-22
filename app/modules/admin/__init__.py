"""Admin module - placeholder.

The feat/admin worktree builds this module and only touches app/modules/admin/,
migrations/admin/, tests/admin/ and its pages under web/. Put models in
app/modules/admin/models.py (schema "admin"), API routes on the router below (mounted at
/api/admin), and register dashboard widgets on the Module.
"""

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut

ROLES = {"admin"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="admin:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="admin", title="Admin", status="coming_soon")


module = Module(
    name="admin",
    title="Admin",
    router=router,
    nav=[NavItem(label="Overview", path="/admin", icon="shield", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Admin", "Users, roles, settings and audit log")],
)
