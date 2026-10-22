"""People & payroll module - placeholder.

The feat/payroll worktree builds this module and only touches app/modules/payroll/,
migrations/payroll/ and tests/payroll/. Put models in app/modules/payroll/models.py (schema
"payroll"), templates under app/modules/payroll/templates/payroll/, and register dashboard
widgets on the Module below.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.templating import render_placeholder

ROLES = {"admin", "manager"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", name="payroll:index")
async def index(request: Request) -> Response:
    return render_placeholder(
        request, title="People & payroll", subtitle="Employees, salaries and monthly payroll"
    )


module = Module(
    name="payroll",
    title="People & payroll",
    router=router,
    nav=[NavItem(label="Overview", path="/payroll", icon="users", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("People & payroll")],
)
