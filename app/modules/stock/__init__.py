"""Stock module: products with variations, movements (opening / purchase / consumption).

The frontend (web/components/stock/) is complete against a typed mock API; the JSON endpoints
listed in web/components/stock/api.ts are the next step. Until they exist this module only
registers the navigation and the dashboard widget kinds, and the widgets' ``data`` stays empty
so the frontend renderers fall back to their own fetch.
"""

from typing import Any

from fastapi import APIRouter, Depends

from app.core.auth import require_role
from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ModuleStatusOut

ROLES = {"admin", "manager", "store_keeper"}

router = APIRouter(dependencies=[Depends(require_role(*ROLES))])


@router.get("", response_model=ModuleStatusOut, name="stock:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="stock", title="Stock", status="coming_soon")


# Widget kinds rendered by web/components/stock/widgets/index.tsx. TODO(backend): fill ``data``
# with StockStatsData / LowStockData / CurrentStockData (web/components/stock/types.ts).
async def stats_widget(ctx: WidgetContext) -> dict[str, Any]:
    return {"kind": "stock_stats", "title": "Stock", "data": {}}


async def low_stock_widget(ctx: WidgetContext) -> dict[str, Any]:
    return {"kind": "stock_low", "title": "Low in stock", "data": {}}


async def current_stock_widget(ctx: WidgetContext) -> dict[str, Any]:
    return {"kind": "stock_current", "title": "Current stock", "data": {}}


module = Module(
    name="stock",
    title="Stock",
    router=router,
    nav=[
        NavItem(label="Items", path="/stock/items", icon="box", roles=set(ROLES)),
        NavItem(label="Stock entry", path="/stock/entry", icon="plus", roles=set(ROLES)),
        NavItem(label="Stock report", path="/stock/report", icon="list", roles=set(ROLES)),
    ],
    dashboard_widgets=[stats_widget, low_stock_widget, current_stock_widget],
)
