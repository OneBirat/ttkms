"""People & payroll module (sidebar section "People").

The feat/payroll worktree builds this module and only touches app/modules/payroll/,
migrations/payroll/, tests/payroll/ and its pages under web/app/people/. Put models in
app/modules/payroll/models.py (schema "payroll"), API routes on the router below (mounted at
/api/payroll), and register dashboard widgets on the Module.

Access is per user (app.modules.admin.permissions): ``manage_employees`` opens Employees
(Manager and Admin presets), ``salary_advances`` opens Salary report and Payments (Admin preset,
or switched on for a user). Guard real endpoints with ``require_access(<permission>)``.
"""

from fastapi import APIRouter, Depends

from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut
from app.modules.admin.permissions import require_any_access

EMPLOYEES = "manage_employees"
SALARY = "salary_advances"

router = APIRouter(dependencies=[Depends(require_any_access(EMPLOYEES, SALARY))])


@router.get("", response_model=ModuleStatusOut, name="payroll:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="payroll", title="People & payroll", status="coming_soon")


module = Module(
    name="payroll",
    title="People & payroll",
    router=router,
    nav=[
        NavItem(label="Employees", path="/people/employees", icon="users", permission=EMPLOYEES),
        NavItem(label="Salary report", path="/people/salary", icon="banknote", permission=SALARY),
        NavItem(label="Payments", path="/people/payments", icon="list", permission=SALARY),
    ],
    dashboard_widgets=[
        coming_soon_widget("People & payroll", "Employees, salaries and monthly payroll")
    ],
)
