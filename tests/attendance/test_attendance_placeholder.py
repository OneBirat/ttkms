"""Attendance module tests (feat/attendance worktree): registry entries and the dashboard widget.

The screens run on mock data in the browser for now; these tests cover what the backend already
registers. The real endpoints (API_NOTES.md) get their own test files when they land.
"""

import pytest

from app.modules.attendance import SAMPLE_TODAY, module

pytestmark = pytest.mark.anyio


async def test_attendance_index_still_coming_soon(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/attendance")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "attendance"


async def test_staff_can_open_the_module(client, make_user, login):
    """The Staff preset is ``mark_attendance`` only - enough to reach the module."""
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/api/attendance")
    assert response.status_code == 200


async def test_sidebar_entries_for_managers(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/registry")
    assert response.status_code == 200
    attendance = next(m for m in response.json()["modules"] if m["name"] == "attendance")
    assert [(i["label"], i["path"]) for i in attendance["nav"]] == [
        ("Mark attendance", "/attendance/mark"),
        ("Attendance report", "/attendance/report"),
    ]


async def test_staff_see_marking_but_not_the_report(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/api/registry")
    attendance = next(m for m in response.json()["modules"] if m["name"] == "attendance")
    assert [(i["label"], i["path"]) for i in attendance["nav"]] == [
        ("Mark attendance", "/attendance/mark")
    ]


async def test_dashboard_widget_is_attendance_today_only(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/dashboard")
    assert response.status_code == 200
    widgets = [w for w in response.json()["widgets"] if w["module"] == "attendance"]
    assert [w["kind"] for w in widgets] == ["attendance_today"]
    assert widgets[0]["title"] == "Attendance today"
    today = widgets[0]["data"]
    assert today == SAMPLE_TODAY
    # P / O / A / not marked add up to the headcount; no late / half / leave anywhere.
    counted = today["present"] + today["overtime"] + today["absent"] + today["not_marked"]
    assert counted == today["total"]
    assert {"late", "half_day", "leave", "on_time"}.isdisjoint(today)
    assert {e["status"] for e in today["not_in"]} <= {"A", "N"}
    assert today["mark_path"] == "/attendance/mark"
