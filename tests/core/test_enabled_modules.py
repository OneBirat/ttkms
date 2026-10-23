"""ENABLED_MODULES: a paused module is invisible everywhere, and comes back with one setting."""

import pytest

from app.config import DEFAULT_ENABLED_MODULES, Settings, parse_module_list, settings
from app.core.modules import enabled_modules, is_enabled, load_modules
from tests.conftest import login_as

pytestmark = pytest.mark.anyio

DEFAULT = "attendance,payroll,admin"
WITH_STOCK = "stock,attendance,payroll,admin"


def test_default_setting_excludes_stock():
    assert DEFAULT_ENABLED_MODULES == DEFAULT
    assert Settings.model_fields["enabled_modules"].default == DEFAULT
    assert parse_module_list(DEFAULT) == ("attendance", "payroll", "admin")


def test_parse_module_list_normalises_and_orders():
    assert parse_module_list(" Admin, stock ,attendance,admin") == ("stock", "attendance", "admin")
    assert parse_module_list("") == ()
    with pytest.raises(ValueError, match="unknown module"):
        parse_module_list("attendance,warehouse")


def test_is_enabled_reads_settings_live(monkeypatch):
    monkeypatch.setattr(settings, "enabled_modules", DEFAULT)
    assert enabled_modules() == ("attendance", "payroll", "admin")
    assert not is_enabled("stock") and is_enabled("attendance")
    assert [m.name for m in load_modules()] == ["attendance", "payroll", "admin"]
    monkeypatch.setattr(settings, "enabled_modules", WITH_STOCK)
    assert is_enabled("stock")
    assert [m.name for m in load_modules()] == ["stock", "attendance", "payroll", "admin"]
    assert [m.name for m in load_modules(["admin", "stock"])] == ["stock", "admin"]


async def test_stock_disabled_everywhere(client_for, make_user):
    await make_user("admin")
    async with client_for(DEFAULT) as client:
        await login_as(client, "admin")
        for path in ("/api/stock", "/api/stock/items", "/api/stock/entries/today"):
            assert (await client.get(path)).status_code == 404, path

        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["attendance", "payroll", "admin"]
        assert [s["module"] for s in modules["nav"]] == ["attendance", "payroll", "admin"]
        assert [s["title"] for s in modules["nav"]] == ["Attendance", "People & payroll", "Admin"]
        assert modules["nav"][0]["items"] == [
            {"label": "Overview", "path": "/attendance", "icon": "calendar"}
        ]
        assert not any("stock" in i["path"] for s in modules["nav"] for i in s["items"])

        registry = (await client.get("/api/registry")).json()["modules"]
        assert [m["name"] for m in registry] == ["attendance", "payroll", "admin"]

        dashboard = (await client.get("/api/dashboard")).json()
        assert [w["module"] for w in dashboard["widgets"]] == ["attendance", "payroll", "admin"]
        assert not any("stock" in s["label"].lower() for s in dashboard["stats"])
        assert not any("stock" in w["title"].lower() for w in dashboard["widgets"])

        openapi = (await client.get("/api/openapi.json")).json()["paths"]
        assert not any(path.startswith("/api/stock") for path in openapi)


async def test_modules_nav_is_filtered_by_role(client_for, make_user):
    await make_user("clerk", role="staff")
    async with client_for(DEFAULT) as client:
        await login_as(client, "clerk")
        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["attendance", "payroll", "admin"]
        assert [s["module"] for s in modules["nav"]] == ["attendance"]


async def test_modules_requires_login(client):
    response = await client.get("/api/core/modules")
    assert response.status_code == 401


async def test_stock_mounts_again_when_enabled(client_for, make_user):
    await make_user("admin")
    async with client_for(WITH_STOCK) as client:
        await login_as(client, "admin")
        response = await client.get("/api/stock")
        assert response.status_code == 200
        assert response.json() == {"module": "stock", "title": "Stock", "status": "coming_soon"}

        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["stock", "attendance", "payroll", "admin"]
        assert modules["nav"][0] == {
            "module": "stock",
            "title": "Stock",
            "items": [{"label": "Overview", "path": "/stock", "icon": "box"}],
        }
        dashboard = (await client.get("/api/dashboard")).json()
        assert [w["module"] for w in dashboard["widgets"]][0] == "stock"
