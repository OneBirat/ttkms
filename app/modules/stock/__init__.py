"""Stock module - placeholder.

The feat/stock worktree builds this module and only touches app/modules/stock/,
migrations/stock/ and tests/stock/. Put models in app/modules/stock/models.py (schema
"stock"), templates under app/modules/stock/templates/stock/, and register dashboard
widgets on the Module below.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.auth import require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.templating import render_placeholder

ROLES = {"admin", "manager", "store_keeper"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", name="stock:index")
async def index(request: Request) -> Response:
    return render_placeholder(
        request, title="Stock", subtitle="Items, purchases, sales and stock levels"
    )


module = Module(
    name="stock",
    title="Stock",
    router=router,
    nav=[NavItem(label="Overview", path="/stock", icon="box", roles=set(ROLES))],
    dashboard_widgets=[coming_soon_widget("Stock")],
)
