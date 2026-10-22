"""Attendance module tests (feat/attendance worktree): registry entries and dashboard widgets."""

import pytest

from app.modules.attendance import module

pytestmark = pytest.mark.anyio


async def test_attendance_index_still_coming_soon(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/attendance")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "attendance"


async def test_staff_cannot_open_the_module(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/api/attendance")
    assert response.status_code == 403


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


async def test_staff_do_not_see_marking_entries(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/api/registry")
    attendance = next(m for m in response.json()["modules"] if m["name"] == "attendance")
    assert attendance["nav"] == []


async def test_dashboard_widgets(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/dashboard")
    assert response.status_code == 200
    widgets = [w for w in response.json()["widgets"] if w["module"] == "attendance"]
    assert [w["kind"] for w in widgets] == ["attendance_stat", "attendance_today"]
    stat = widgets[0]["data"]
    assert stat["present"] == 11 and stat["total"] == 14
    assert stat["late"] == 2 and stat["leave"] == 1
    today = widgets[1]["data"]
    assert today["on_time"] + today["late"] + today["leave"] + today["absent"] == today["total"]
    assert [e["name"] for e in today["not_in"]] == ["Sita Thapa", "Ramesh K.C."]
    assert today["mark_path"] == "/attendance/mark"
