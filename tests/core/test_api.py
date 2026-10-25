"""Core JSON endpoints: registry, dashboard, today, BS conversion."""

import pytest

from app.core import bsdate
from app.core.models import Role
from app.main import MODULES
from app.modules.attendance import SAMPLE_TODAY
from tests.core.test_modules import frontend_prefix

pytestmark = pytest.mark.anyio

#: Dashboard cards: only "Attendance today" and "Payments today"; admin has none.
WIDGET_KINDS = {"attendance": ["attendance_today"], "payroll": ["payments_today"], "admin": []}


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


async def test_dashboard_widgets(client, make_user, login):
    """Only the two real cards, in sidebar order; the old core stat row is gone."""
    await make_user("admin")
    await login("admin")
    data = (await client.get("/api/dashboard")).json()
    assert "stats" not in data
    widgets = data["widgets"]
    assert [w["module"] for w in widgets] == ["attendance", "payroll"]
    assert [w["kind"] for w in widgets] == [k for m in MODULES for k in WIDGET_KINDS[m.name]]
    assert [w["title"] for w in widgets] == ["Attendance today", "Payments today"]
    assert all(isinstance(w["data"], dict) for w in widgets)
    payments = widgets[1]["data"]
    # Real rows now (tests/payroll/test_contract_and_dashboard.py); a fresh database has none.
    assert payments["count"] == 0 and payments["payments"] == []
    assert payments["total"] == payments["salary_total"] + payments["advance_total"] == 0
    assert payments["date"] == bsdate.header_date().ad_date.isoformat()
    assert payments["payments_path"] == "/people/payments"


async def test_today_endpoint_is_public(client):
    data = (await client.get("/api/today")).json()
    header = bsdate.header_date()
    assert data["date"] == header.ad_date.isoformat()
    assert data["date_bs"] == header.bs_date.isoformat()
    assert data["weekday"] == header.bs_date.weekday
    assert data["fiscal_year"] == bsdate.fiscal_year(header.bs_date).label
    assert data["text"]["ad"] == header.ad
    assert data["text"]["full"] == header.full
    assert data["text"]["np"].endswith(bsdate.to_nepali_digits(header.bs_date.year))
    assert data["counts"] is None, "headline numbers only for a signed-in caller"


async def test_today_counts_for_signed_in_users(client, make_user, login):
    """The dashboard stat row: attendance's sample figures and payroll's real ones (nothing paid
    in a fresh database) merged."""
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts == {
        "total": SAMPLE_TODAY["total"],
        "present": SAMPLE_TODAY["present"],
        "overtime": SAMPLE_TODAY["overtime"],
        "overtime_hours": SAMPLE_TODAY["overtime_hours"],
        "absent": SAMPLE_TODAY["absent"],
        "not_marked": SAMPLE_TODAY["not_marked"],
        "paid_today": 0,
        "payments_today": 0,
    }
    assert (
        counts["present"] + counts["overtime"] + counts["absent"] + counts["not_marked"]
        == (counts["total"])
    )


async def test_bs_convert(client):
    response = await client.get("/api/bsdate/convert", params={"date": "2026-10-20"})
    assert response.status_code == 200
    data = response.json()
    assert data["date"] == "2026-10-20" and data["date_bs"] == "2083-07-03"
    assert data["bs_text"] == "Kartik 3, 2083" and data["bs_text_np"] == "कार्तिक ३, २०८३"
    assert data["weekday"] == 2 and data["weekday_np"] == "मंगलबार"
    assert data["fiscal_year"] == "2083/84"
    back = (await client.get("/api/bsdate/convert", params={"date_bs": "2083-7-3"})).json()
    assert back["date"] == "2026-10-20" and back["date_bs"] == "2083-07-03"
    both = await client.get(
        "/api/bsdate/convert", params={"date": "2026-10-20", "date_bs": "2083-07-03"}
    )
    assert both.status_code == 200
    for params in (
        {"date_bs": "2083-13-01"},
        {"date_bs": "2083-07-31"},
        {"date": "1900-01-01"},
        {},
        {"date": "2026-10-20", "date_bs": "2083-07-04"},
    ):
        assert (await client.get("/api/bsdate/convert", params=params)).status_code == 422, params


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
