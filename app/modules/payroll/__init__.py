"""People & payroll module (sidebar section "People").

The feat/payroll worktree builds this module and only touches app/modules/payroll/,
migrations/payroll/, tests/payroll/ and its pages under web/app/people/. Put models in
app/modules/payroll/models.py (schema "payroll"), API routes on the router below (mounted at
/api/payroll), and register dashboard widgets on the Module.
"""

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut

ROLES = {"admin", "manager"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="payroll:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="payroll", title="People & payroll", status="coming_soon")


module = Module(
    name="payroll",
    title="People & payroll",
    router=router,
    nav=[
        NavItem(label="Employees", path="/people/employees", icon="users", roles=set(ROLES)),
        NavItem(label="Salary report", path="/people/salary", icon="banknote", roles=set(ROLES)),
        NavItem(label="Payments", path="/people/payments", icon="list", roles=set(ROLES)),
    ],
    dashboard_widgets=[
        coming_soon_widget("People & payroll", "Employees, salaries and monthly payroll")
    ],
)
