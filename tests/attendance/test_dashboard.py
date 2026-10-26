"""The "Attendance today" card and attendance's share of /api/today: real counts of today's
records (Kathmandu day), branch-scoped, Saturday-aware."""

from datetime import UTC, date, datetime

import pytest

from app.modules.attendance import services
from app.modules.attendance.models import Record

pytestmark = pytest.mark.anyio

WEDNESDAY = date(2026, 10, 21)
SATURDAY = date(2026, 10, 24)


def _at(monkeypatch, day: date) -> None:
    monkeypatch.setattr(services, "now", lambda: datetime.combine(day, datetime.min.time(), UTC))


def _rec(employee, day, status, hours=0):
    return Record(
        employee_id=employee.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=employee.branch_id,
        source="manual",
    )


async def _widget(client):
    widgets = (await client.get("/api/dashboard")).json()["widgets"]
    mine = [w for w in widgets if w["module"] == "attendance"]
    assert [w["kind"] for w in mine] == ["attendance_today"]
    assert mine[0]["title"] == "Attendance today"
    return mine[0]["data"]


async def test_widget_and_counts_for_a_branch(client, db, login, user_in, world, monkeypatch):
    _at(monkeypatch, WEDNESDAY)
    p = world.people
    db.add_all(
        [
            _rec(p["Anita"], WEDNESDAY, "O", 2),
            _rec(p["Bikash"], WEDNESDAY, "A"),
            _rec(p["Mina"], WEDNESDAY, "P"),  # other branch
            _rec(p["Chandra"], date(2026, 10, 20), "P"),  # yesterday
        ]
    )
    await db.flush()
    await user_in("boss", "manager", world.main)
    await login("boss")
    data = await _widget(client)
    assert data == {
        "total": 3,
        "present": 0,
        "overtime": 1,
        "overtime_hours": 2,
        "absent": 1,
        "not_marked": 1,
        "weekly_off": False,
        "not_in": [
            {"employee_id": p["Bikash"].id, "name": "Bikash", "status": "A"},
            {"employee_id": p["Chandra"].id, "name": "Chandra", "status": "N"},
        ],
        "mark_path": "/attendance/mark",
    }
    counts = (await client.get("/api/today")).json()["counts"]
    assert {k: counts[k] for k in ("total", "present", "overtime", "absent", "not_marked")} == {
        "total": 3,
        "present": 0,
        "overtime": 1,
        "absent": 1,
        "not_marked": 1,
    }


async def test_admin_sees_only_the_active_branch(client, db, make_user, login, world, monkeypatch):
    """No more "every branch": the card and /api/today count the active branch, and switching
    it switches the numbers."""
    _at(monkeypatch, WEDNESDAY)
    db.add(_rec(world.people["Mina"], WEDNESDAY, "P"))
    await db.flush()
    await make_user("chief", role="admin")
    await login("chief")
    data = await _widget(client)  # Main branch (the first branch created)
    assert data["total"] == 3 and data["present"] == 0 and data["not_marked"] == 3
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts["total"] == 3 and counts["present"] == 0
    h = {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}
    switched = await client.put(
        "/api/me/active-branch", json={"branch_id": world.second.id}, headers=h
    )
    assert switched.status_code == 200, switched.text
    data = await _widget(client)
    assert data["total"] == 1 and data["present"] == 1 and data["not_marked"] == 0
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts["total"] == 1 and counts["present"] == 1


async def test_saturday_needs_no_marks(client, db, login, user_in, world, monkeypatch):
    _at(monkeypatch, SATURDAY)
    db.add(_rec(world.people["Anita"], SATURDAY, "O", 4))
    await db.flush()
    await user_in("boss", "manager", world.main)
    await login("boss")
    data = await _widget(client)
    assert data["weekly_off"] is True
    assert (data["overtime"], data["not_marked"], data["not_in"]) == (1, 0, [])
