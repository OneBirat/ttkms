"""Attendance module registration: index, sidebar entries and the dashboard widget."""

import pytest

from app.modules.attendance import module

pytestmark = pytest.mark.anyio


async def test_attendance_index_is_ready(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    response = await client.get("/api/attendance")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"
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
