"""Stock module registration: navigation, dashboard widget kinds and the index endpoint.

The stock endpoints themselves are the next step (see web/components/stock/api.ts).
"""

import pytest

from app.modules.stock import module

pytestmark = pytest.mark.anyio

NAV = [
    ("Items", "/stock/items"),
    ("Stock entry", "/stock/entry"),
    ("Stock report", "/stock/report"),
]
WIDGET_KINDS = ["stock_stats", "stock_low", "stock_current"]


def test_module_nav_and_widgets():
    assert module.name == "stock"
    assert [(item.label, item.path) for item in module.nav] == NAV
    assert all(item.roles == {"admin", "manager", "store_keeper"} for item in module.nav)
    assert module.visible_nav("staff") == []
    assert [w.__name__ for w in module.dashboard_widgets] == [
        "stats_widget",
        "low_stock_widget",
        "current_stock_widget",
    ]


async def test_registry_lists_stock_pages_for_store_keeper(client, make_user, login):
    await make_user("keeper", role="store_keeper")
    await login("keeper")
    response = await client.get("/api/registry")
    assert response.status_code == 200
    stock = next(m for m in response.json()["modules"] if m["name"] == "stock")
    assert stock["allowed"] is True
    assert [(item["label"], item["path"]) for item in stock["nav"]] == NAV
    assert {item["icon"] for item in stock["nav"]} == {"box", "plus", "list"}


async def test_dashboard_carries_stock_widget_kinds(client, make_user, login):
    await make_user("keeper", role="store_keeper")
    await login("keeper")
    response = await client.get("/api/dashboard")
    assert response.status_code == 200
    kinds = [w["kind"] for w in response.json()["widgets"] if w["module"] == "stock"]
    assert kinds == WIDGET_KINDS


async def test_stock_index_requires_stock_role(client, make_user, login):
    await make_user("keeper", role="store_keeper")
    await login("keeper")
    response = await client.get("/api/stock")
    assert response.status_code == 200
    assert response.json()["module"] == "stock"
