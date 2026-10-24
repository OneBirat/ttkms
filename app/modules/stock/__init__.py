"""Stock module - placeholder.

The feat/stock worktree builds this module and only touches app/modules/stock/,
migrations/stock/, tests/stock/ and its pages under web/. Put models in
app/modules/stock/models.py (schema "stock"), API routes on the router below (mounted at
/api/stock), and register dashboard widgets on the Module.
"""

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut

ROLES = {"admin", "manager"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="stock:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="stock", title="Stock", status="coming_soon")


module = Module(
    name="stock",
    title="Stock",
    router=router,
    nav=[NavItem(label="Overview", path="/stock", icon="box", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Stock", "Items, purchases, sales and stock levels")],
)
