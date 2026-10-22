"""Admin module.

The feat/admin worktree builds this module and only touches app/modules/admin/,
migrations/admin/, tests/admin/ and its pages under web/. The UI (web/components/admin/)
currently runs on mock data; the JSON endpoints under /api/admin follow in the next session
and will manage rows in the core tables (users, branches, departments, settings, audit_log)
through app/core/services.py without changing the core schema.
"""

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut

ROLES = {"admin"}
#: Managers may open Branches & departments read-only.
ORG_ROLES = {"admin", "manager"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="admin:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="admin", title="Admin", status="coming_soon")


NAV = [
    NavItem(label="Users & roles", path="/admin/users", icon="users", roles=set(ROLES)),
    NavItem(label="Branches & departments", path="/admin/org", icon="box", roles=set(ORG_ROLES)),
    NavItem(label="Settings", path="/admin/settings", icon="shield", roles=set(ROLES)),
    NavItem(label="Audit log", path="/admin/audit", icon="file", roles=set(ROLES)),
]

module = Module(
    name="admin",
    title="Admin",
    router=router,
    nav=NAV,
    dashboard_widgets=[coming_soon_widget("Admin", "Users, roles, settings and audit log")],
)
