"""Admin module - placeholder.

The feat/admin worktree builds this module and only touches app/modules/admin/,
migrations/admin/ and tests/admin/. Put models in app/modules/admin/models.py (schema
"admin"), templates under app/modules/admin/templates/admin/, and register dashboard
widgets on the Module below.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.templating import render_placeholder

ROLES = {"admin"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", name="admin:index")
async def index(request: Request) -> Response:
    return render_placeholder(
        request, title="Admin", subtitle="Users, roles, settings and audit log"
    )


module = Module(
    name="admin",
    title="Admin",
    router=router,
    nav=[NavItem(label="Overview", path="/admin", icon="shield", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Admin")],
)
