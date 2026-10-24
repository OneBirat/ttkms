"""Core JSON endpoints: registry, dashboard, today, BS conversion."""

from datetime import date

import pytest

from app.core import bsdate
from app.core.models import Role
from app.main import MODULES
from tests.core.test_modules import frontend_prefix

pytestmark = pytest.mark.anyio

#: Dashboard card per module: attendance has its real "Attendance today" card, the rest are stubs.
WIDGET_KINDS = {"attendance": "attendance_today", "payroll": "coming_soon", "admin": "coming_soon"}


async def test_registry_for_admin(client, make_user, login):
    await make_user("admin")
    await login("admin")
    data = (await client.get("/api/registry")).json()
    modules = data["modules"]
    assert [m["name"] for m in modules] == [m.name for m in MODULES]
    assert [m["title"] for m in modules] == [m.title for m in MODULES]
    assert all(m["allowed"] for m in modules)
    for m in modules:
        assert m["nav"] and m["nav"][0]["path"].startswith(frontend_prefix(m["name"])), m["name"]
        assert {"label", "path", "icon", "roles", "permission"} <= set(m["nav"][0])


async def test_registry_filters_nav_by_access(client, make_user, login):
    """The Staff preset is mark_attendance only: one attendance entry, nothing else."""
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    modules = {m["name"]: m for m in (await client.get("/api/registry")).json()["modules"]}
    assert modules["attendance"]["allowed"]
    assert [i["label"] for i in modules["attendance"]["nav"]] == ["Mark attendance"]
    for name in ("payroll", "admin"):
        assert not modules[name]["allowed"] and modules[name]["nav"] == []


async def test_registry_requires_login(client):
    response = await client.get("/api/registry")
    assert response.status_code == 401
    assert response.json() == {"detail": "login required"}


async def test_dashboard_stats_and_widgets(client, make_user, login):
    await make_user("admin")
    await login("admin")
    data = (await client.get("/api/dashboard")).json()
    assert [s["label"] for s in data["stats"]] == [
        "Active employees", "Branches", "Departments", "Users",
    ]  # fmt: skip
    assert data["stats"][3]["value"] == 1
    assert data["stats"][0]["tone"] == "ok"
    widgets = data["widgets"]
    assert [w["module"] for w in widgets] == [m.name for m in MODULES]
    assert [w["kind"] for w in widgets] == [WIDGET_KINDS[m.name] for m in MODULES]
    assert [w["title"] for w in widgets if w["module"] == "attendance"] == ["Attendance today"]
    assert [w["title"] for w in widgets if w["module"] == "payroll"] == ["People & payroll"]
    assert all(isinstance(w["data"], dict) for w in widgets)


async def test_today_endpoint_is_public(client):
    data = (await client.get("/api/today")).json()
    header = bsdate.header_date()
    assert data["ad"] == header.ad_date.isoformat()
    assert data["available"] == header.available
    assert data["text"]["ad"] == header.ad
    assert data["text"]["full"] == header.full
    if header.available:
        assert data["bs"] == header.bs_date.isoformat()
        assert data["text"]["np"].endswith(bsdate.to_devanagari_digits(header.bs_date.year))
    else:
        assert data["bs"] is None and data["text"]["np"] == ""


async def test_bs_convert(client):
    response = await client.get("/api/bsdate/convert", params={"ad": "2026-10-20"})
    if not bsdate.is_available():
        assert response.status_code == 503
        assert "not installed" in response.json()["detail"]
        return
    assert response.status_code == 200
    data = response.json()
    assert data["ad"] == "2026-10-20"
    assert data["bs"] == bsdate.ad_to_bs(date(2026, 10, 20)).isoformat()
    assert data["weekday_np"] == "मंगलबार"
    back = (await client.get("/api/bsdate/convert", params={"bs": data["bs"]})).json()
    assert back["ad"] == "2026-10-20"
    assert (await client.get("/api/bsdate/convert", params={"bs": "2083-13-01"})).status_code == 422
    assert (await client.get("/api/bsdate/convert")).status_code == 422


async def test_openapi_is_served_in_dev(client):
    response = await client.get("/api/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    for path in (
        "/api/auth/login",
        "/api/auth/me",
        "/api/registry",
        "/api/core/modules",
        "/api/dashboard",
        "/api/today",
    ):
        assert path in paths
