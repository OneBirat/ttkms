"""Marking: the day list, mark / change / clear, bulk Present, the rules (P / O + 1-12 hours /
A, Saturday, future days, the Kathmandu day boundary, inactive staff), permissions, branch
scoping and the audit trail."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.modules.attendance import services
from app.modules.attendance.models import Record, RecordChange

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_ad()


def _last(weekday: int, before: date = TODAY) -> date:
    """The latest day before ``before`` with that weekday (0 = Sunday ... 6 = Saturday)."""
    day = before - timedelta(days=1)
    while bsdate.weekday_index(day) != weekday:
        day -= timedelta(days=1)
    return day


SATURDAY = _last(6)
WORKDAY = _last(3)  # a Wednesday
BS_SAT = bsdate.ad_to_bs(SATURDAY).isoformat()
BS_DAY = bsdate.ad_to_bs(WORKDAY).isoformat()


async def _headers(client):
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _as(client, login, user_in, name="boss", role="manager", branch=None, access=None):
    await user_in(name, role, branch, access)
    await login(name)
    return await _headers(client)


def _mark(employee, status="P", hours=0, day=BS_DAY, **extra):
    return {
        "date_bs": day,
        "employee_id": employee.id,
        "status": status,
        "ot_hours": hours,
        **extra,
    }


async def _changes(db, employee):
    rows = await db.scalars(
        select(RecordChange)
        .where(RecordChange.employee_id == employee.id)
        .order_by(RecordChange.id)
    )
    return [(c.old_status, c.new_status, c.old_hours, c.new_hours, c.source) for c in rows]


async def test_mark_change_overtime_and_clear(client, db, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    anita = world.people["Anita"]
    first = await client.post("/api/attendance/mark", json=_mark(anita), headers=h)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["previous"] == "N" and body["date"] == WORKDAY.isoformat()
    assert body["date_bs"] == BS_DAY
    assert body["record"] | {"updated_at": None} == {
        "employee_id": anita.id,
        "date_bs": BS_DAY,
        "date_ad": WORKDAY.isoformat(),
        "status": "P",
        "ot_hours": 0,
        "note": "",
        "marked_by": "boss",
        "marked_via": "manual",
        "updated_at": None,
    }
    again = await client.post("/api/attendance/mark", json=_mark(anita, "O", 3), headers=h)
    assert again.json()["previous"] == "P" and again.json()["record"]["ot_hours"] == 3
    same = await client.post("/api/attendance/mark", json=_mark(anita, "O", 3), headers=h)
    assert same.json()["previous"] == "O"
    absent = await client.post(
        "/api/attendance/mark", json=_mark(anita, "A", note="  sick   leave "), headers=h
    )
    assert absent.json()["record"]["note"] == "sick leave"
    rows = list(await db.scalars(select(Record).where(Record.employee_id == anita.id)))
    assert len(rows) == 1 and rows[0].status == "A" and rows[0].branch_id == world.main.id
    cleared = await client.delete(
        "/api/attendance/mark",
        params={"employee_id": anita.id, "date_bs": BS_DAY},
        headers=h,
    )
    assert cleared.status_code == 200
    assert cleared.json() | {} == {
        "date": WORKDAY.isoformat(),
        "date_bs": BS_DAY,
        "employee_id": anita.id,
        "previous": "A",
        "now": "N",
    }
    assert await db.scalar(select(Record).where(Record.employee_id == anita.id)) is None
    twice = await client.delete(
        "/api/attendance/mark", params={"employee_id": anita.id, "date_bs": BS_DAY}, headers=h
    )
    assert twice.json()["previous"] == "N"
    # Every real change is in the audit trail; the no-op save is not.
    assert await _changes(db, anita) == [
        (None, "P", 0, 0, "manual"),
        ("P", "O", 0, 3, "manual"),
        ("O", "A", 3, 0, "manual"),
        ("A", None, 0, 0, "manual"),
    ]


@pytest.mark.parametrize(
    ("status", "hours", "message"),
    [
        ("O", 0, "Overtime needs 1–12 whole hours."),
        ("O", 13, "Overtime needs 1–12 whole hours."),
        ("P", 2, "Only overtime (O) carries hours."),
        ("A", 1, "Only overtime (O) carries hours."),
    ],
)
async def test_overtime_validation(client, login, user_in, world, status, hours, message):
    h = await _as(client, login, user_in, branch=world.main)
    response = await client.post(
        "/api/attendance/mark", json=_mark(world.people["Anita"], status, hours), headers=h
    )
    assert response.status_code == 422
    assert response.json()["detail"] == message


async def test_bad_dates_and_future_days(client, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    anita = world.people["Anita"]
    bad = await client.post("/api/attendance/mark", json=_mark(anita, day="2083-13-01"), headers=h)
    assert bad.status_code == 422 and bad.json()["detail"] == "2083-13-01 is not a valid BS date."
    tomorrow = bsdate.ad_to_bs(TODAY + timedelta(days=1)).isoformat()
    for response in (
        await client.post("/api/attendance/mark", json=_mark(anita, day=tomorrow), headers=h),
        await client.get("/api/attendance/day", params={"date_bs": tomorrow}),
        await client.delete(
            "/api/attendance/mark", params={"employee_id": anita.id, "date_bs": tomorrow}, headers=h
        ),
        await client.post(
            "/api/attendance/bulk-mark",
            json={"date_bs": tomorrow, "branch_id": world.main.id, "employee_ids": [anita.id]},
            headers=h,
        ),
    ):
        assert response.status_code == 422
        assert response.json()["detail"] == "Attendance cannot be marked for a future day."
    today = bsdate.ad_to_bs(TODAY).isoformat()
    ok = await client.post("/api/attendance/mark", json=_mark(anita, day=today), headers=h)
    assert ok.status_code == 200


async def test_kathmandu_day_boundary(client, login, user_in, world, monkeypatch):
    """Kathmandu is UTC+5:45: 18:14 UTC is 23:59 there (still the 20th), 18:16 UTC is 00:01 on
    the 21st - only then may the 21st be marked."""
    h = await _as(client, login, user_in, branch=world.main)
    the_21st = date(2026, 10, 21)
    body = _mark(world.people["Anita"], day=bsdate.ad_to_bs(the_21st).isoformat())
    monkeypatch.setattr(services, "now", lambda: datetime(2026, 10, 20, 18, 14, tzinfo=UTC))
    assert services.today() == date(2026, 10, 20)
    late = await client.post("/api/attendance/mark", json=body, headers=h)
    assert late.status_code == 422
    monkeypatch.setattr(services, "now", lambda: datetime(2026, 10, 20, 18, 16, tzinfo=UTC))
    assert services.today() == the_21st
    early = await client.post("/api/attendance/mark", json=body, headers=h)
    assert early.status_code == 200
    assert early.json()["record"]["date_ad"] == "2026-10-21"


async def test_saturday_work_is_stored_but_never_absent(client, db, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    anita = world.people["Anita"]
    absent = await client.post(
        "/api/attendance/mark", json=_mark(anita, "A", day=BS_SAT), headers=h
    )
    assert absent.status_code == 422 and "weekly off" in absent.json()["detail"]
    worked = await client.post(
        "/api/attendance/mark", json=_mark(anita, "O", 4, day=BS_SAT), headers=h
    )
    assert worked.status_code == 200 and worked.json()["previous"] == "N"
    record = await db.scalar(select(Record).where(Record.employee_id == anita.id))
    assert (record.date, record.status, record.overtime_hours) == (SATURDAY, "O", 4)
    day = (await client.get("/api/attendance/day", params={"date_bs": BS_SAT})).json()
    assert day["day"]["is_weekly_off"] is True and day["settings"] == {"weekly_off": 6}
    cleared = await client.delete(
        "/api/attendance/mark", params={"employee_id": anita.id, "date_bs": BS_SAT}, headers=h
    )
    assert cleared.json()["previous"] == "O" and cleared.json()["now"] == "W"


async def test_inactive_and_not_yet_joined_cannot_be_marked(client, db, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    old = await client.post("/api/attendance/mark", json=_mark(world.people["Old Hari"]), headers=h)
    assert old.status_code == 404
    chandra = world.people["Chandra"]
    chandra.joined_ad = TODAY
    await db.flush()
    early = await client.post("/api/attendance/mark", json=_mark(chandra), headers=h)
    assert early.status_code == 422 and "joined on" in early.json()["detail"]
    day = (await client.get("/api/attendance/day", params={"date_bs": BS_DAY})).json()
    names = [r["employee"]["name"] for r in day["rows"]]
    assert "Old Hari" not in names and "Chandra" not in names


async def test_day_list_rows_departments_and_branches(client, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    await client.post("/api/attendance/mark", json=_mark(world.people["Bikash"], "O", 2), headers=h)
    response = await client.get("/api/attendance/day", params={"date_bs": BS_DAY})
    assert response.status_code == 200
    day = response.json()
    assert day["date"] == WORKDAY.isoformat() and day["date_bs"] == BS_DAY
    assert day["day"]["bs_date"] == BS_DAY and day["day"]["is_weekly_off"] is False
    # Department, then name; only the caller's branch.
    assert [
        (r["employee"]["name"], r["record"] and r["record"]["status"]) for r in day["rows"]
    ] == [
        ("Bikash", "O"),
        ("Anita", None),
        ("Chandra", None),
    ]
    assert [(d["name"], d["headcount"]) for d in day["departments"]] == [
        ("Kitchen", 1),
        ("Store", 2),
    ]
    assert [(b["name"], b["headcount"]) for b in day["branches"]] == [("Main branch", 3)]
    row = day["rows"][0]["employee"]
    assert row["code"].startswith("E-") and row["barcode"] == "TTK-" + row["code"].replace("-", "")
    assert row["branch_name"] == "Main branch" and row["department_name"] == "Kitchen"
    only_store = await client.get(
        "/api/attendance/day", params={"date_bs": BS_DAY, "department_id": world.store.id}
    )
    assert [r["employee"]["name"] for r in only_store.json()["rows"]] == ["Anita", "Chandra"]


async def test_branch_scoping(client, login, user_in, world):
    """A manager only ever sees and marks their own branch, whatever the query says; an admin
    (see_other_branches) picks any branch."""
    h = await _as(client, login, user_in, branch=world.main)
    mina = world.people["Mina"]
    other = await client.get(
        "/api/attendance/day", params={"date_bs": BS_DAY, "branch": world.second.id}
    )
    assert {r["employee"]["branch_id"] for r in other.json()["rows"]} == {world.main.id}
    denied = await client.post("/api/attendance/mark", json=_mark(mina), headers=h)
    assert denied.status_code == 403
    bulk = await client.post(
        "/api/attendance/bulk-mark",
        json={"date_bs": BS_DAY, "branch_id": world.second.id, "employee_ids": [mina.id]},
        headers=h,
    )
    assert bulk.json()["marked"] == [] and bulk.json()["skipped"] == []
    await client.post("/api/auth/logout", headers=h)
    h = await _as(client, login, user_in, "chief", "admin")
    second = await client.get(
        "/api/attendance/day", params={"date_bs": BS_DAY, "branch": world.second.id}
    )
    assert [r["employee"]["name"] for r in second.json()["rows"]] == ["Mina"]
    assert {b["name"] for b in second.json()["branches"]} == {"Main branch", "Branch 2"}
    assert (
        await client.post("/api/attendance/mark", json=_mark(mina), headers=h)
    ).status_code == 200


async def test_a_user_without_a_branch_sees_nobody(client, login, user_in, world):
    await _as(client, login, user_in, "floater", "manager", None)
    day = (await client.get("/api/attendance/day", params={"date_bs": BS_DAY})).json()
    assert day["rows"] == [] and day["branches"] == []


async def test_bulk_marks_only_the_unmarked(client, db, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    anita, bikash, chandra = (world.people[n] for n in ("Anita", "Bikash", "Chandra"))
    await client.post("/api/attendance/mark", json=_mark(anita, "A"), headers=h)
    response = await client.post(
        "/api/attendance/bulk-mark",
        json={"date_bs": BS_DAY, "branch_id": world.main.id, "department_id": world.store.id},
        headers=h,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["marked"] == [{"employee_id": chandra.id, "name": "Chandra"}]
    assert body["skipped"] == [anita.id]
    assert [(r["employee_id"], r["status"], r["marked_via"]) for r in body["records"]] == [
        (chandra.id, "P", "bulk")
    ]
    statuses = dict(
        (
            await db.execute(
                select(Record.employee_id, Record.status).where(Record.date == WORKDAY)
            )
        ).all()
    )
    assert statuses == {anita.id: "A", chandra.id: "P"}  # Anita's absence untouched
    by_ids = await client.post(
        "/api/attendance/bulk-mark",
        json={
            "date_bs": BS_DAY,
            "branch_id": world.main.id,
            "employee_ids": [anita.id, bikash.id, chandra.id, world.people["Old Hari"].id],
        },
        headers=h,
    )
    assert by_ids.json()["marked"] == [{"employee_id": bikash.id, "name": "Bikash"}]
    assert sorted(by_ids.json()["skipped"]) == sorted([anita.id, chandra.id])
    assert await _changes(db, bikash) == [(None, "P", 0, 0, "bulk")]


async def test_bulk_needs_a_scope_and_skips_saturday(client, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    none = await client.post(
        "/api/attendance/bulk-mark", json={"date_bs": BS_DAY, "branch_id": world.main.id}, headers=h
    )
    assert (
        none.status_code == 422 and none.json()["detail"] == "Give employee_ids or a department_id."
    )
    sat = await client.post(
        "/api/attendance/bulk-mark",
        json={"date_bs": BS_SAT, "branch_id": world.main.id, "department_id": world.store.id},
        headers=h,
    )
    assert sat.status_code == 422 and "weekly off" in sat.json()["detail"]


async def test_staff_can_mark(client, login, user_in, world):
    h = await _as(client, login, user_in, "clerk", "staff", world.main)
    response = await client.post(
        "/api/attendance/mark", json=_mark(world.people["Anita"]), headers=h
    )
    assert response.status_code == 200
    assert (await client.get("/api/attendance/day", params={"date_bs": BS_DAY})).status_code == 200


async def test_marking_needs_mark_attendance(client, login, user_in, world):
    h = await _as(
        client, login, user_in, "viewer", "manager", world.main, {"mark_attendance": False}
    )
    response = await client.post(
        "/api/attendance/mark", json=_mark(world.people["Anita"]), headers=h
    )
    assert response.status_code == 403
    assert (await client.get("/api/attendance/day", params={"date_bs": BS_DAY})).status_code == 403
