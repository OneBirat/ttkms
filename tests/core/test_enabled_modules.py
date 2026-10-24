"""ENABLED_MODULES: a paused module is invisible everywhere, and comes back with one setting."""

import pytest

from app.config import DEFAULT_ENABLED_MODULES, Settings, parse_module_list, settings
from app.core.modules import enabled_modules, is_enabled, load_modules
from tests.conftest import login_as

pytestmark = pytest.mark.anyio

DEFAULT = "attendance,payroll,admin"
WITHOUT_PAYROLL = "attendance,admin"


def test_default_setting_lists_every_module():
    assert DEFAULT_ENABLED_MODULES == DEFAULT
    assert Settings.model_fields["enabled_modules"].default == DEFAULT
    assert parse_module_list(DEFAULT) == ("attendance", "payroll", "admin")


def test_parse_module_list_normalises_and_orders():
    assert parse_module_list(" Admin, payroll ,attendance,admin") == (
        "attendance",
        "payroll",
        "admin",
    )
    assert parse_module_list("") == ()
    with pytest.raises(ValueError, match="unknown module"):
        parse_module_list("attendance,warehouse")
    # The stock module was removed from the app (its tables stay); it is no longer a module name.
    with pytest.raises(ValueError, match="unknown module"):
        parse_module_list("stock,attendance")


def test_is_enabled_reads_settings_live(monkeypatch):
    monkeypatch.setattr(settings, "enabled_modules", DEFAULT)
    assert enabled_modules() == ("attendance", "payroll", "admin")
    assert is_enabled("payroll") and is_enabled("attendance")
    assert [m.name for m in load_modules()] == ["attendance", "payroll", "admin"]
    monkeypatch.setattr(settings, "enabled_modules", WITHOUT_PAYROLL)
    assert not is_enabled("payroll")
    assert [m.name for m in load_modules()] == ["attendance", "admin"]
    assert [m.name for m in load_modules(["admin", "attendance"])] == ["attendance", "admin"]


async def test_paused_module_is_invisible_everywhere(client_for, make_user):
    await make_user("admin")
    async with client_for(WITHOUT_PAYROLL) as client:
        await login_as(client, "admin")
        for path in ("/api/payroll", "/api/payroll/employees"):
            assert (await client.get(path)).status_code == 404, path

        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["attendance", "admin"]
        assert [s["module"] for s in modules["nav"]] == ["attendance", "admin"]
        assert [s["title"] for s in modules["nav"]] == ["Attendance", "Admin"]
        assert modules["nav"][0]["items"] == [
            {"label": "Mark attendance", "path": "/attendance/mark", "icon": "check"},
            {"label": "Attendance report", "path": "/attendance/report", "icon": "calendar"},
        ]
        assert not any(i["path"].startswith("/people") for s in modules["nav"] for i in s["items"])

        registry = (await client.get("/api/registry")).json()["modules"]
        assert [m["name"] for m in registry] == ["attendance", "admin"]

        dashboard = (await client.get("/api/dashboard")).json()
        assert [w["module"] for w in dashboard["widgets"]] == ["attendance", "admin"]

        openapi = (await client.get("/api/openapi.json")).json()["paths"]
        assert not any(path.startswith("/api/payroll") for path in openapi)
        assert not any(path.startswith("/api/stock") for path in openapi)


async def test_modules_nav_is_filtered_by_access(client_for, make_user):
    await make_user("clerk", role="staff")
    async with client_for(DEFAULT) as client:
        await login_as(client, "clerk")
        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["attendance", "payroll", "admin"]
        assert [s["module"] for s in modules["nav"]] == ["attendance"]
        assert [i["label"] for i in modules["nav"][0]["items"]] == ["Mark attendance"]


async def test_modules_requires_login(client):
    response = await client.get("/api/core/modules")
    assert response.status_code == 401


async def test_module_mounts_again_when_enabled(client_for, make_user):
    await make_user("admin")
    async with client_for(DEFAULT) as client:
        await login_as(client, "admin")
        response = await client.get("/api/payroll")
        assert response.status_code == 200
        assert response.json()["module"] == "payroll"

        modules = (await client.get("/api/core/modules")).json()
        assert modules["enabled"] == ["attendance", "payroll", "admin"]
        assert modules["nav"][1]["module"] == "payroll"
        assert [i["path"] for i in modules["nav"][1]["items"]] == [
            "/people/employees",
            "/people/salary",
            "/people/payments",
        ]
        dashboard = (await client.get("/api/dashboard")).json()
        assert "payroll" in [w["module"] for w in dashboard["widgets"]]
