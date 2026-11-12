"""The super admin's override: create, change or remove any mark on any PAST day (never a future
one), each time with a reason of at least 5 characters, each time logged as an override."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.core.models import Role
from app.modules.admin.models import UserAccess
from app.modules.attendance.models import Record, RecordChange

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_ad()
YESTERDAY = TODAY - timedelta(days=1)


def _workday(before: date) -> date:
    """The latest day before ``before`` that is not a Saturday."""
    day = before - timedelta(days=1)
    while bsdate.weekday_index(day) == 6:
        day -= timedelta(days=1)
    return day


PAST = _workday(TODAY - timedelta(days=20))
REASON = "Was on site, the list was missed"


def bs(day: date) -> str:
    return bsdate.ad_to_bs(day).isoformat()


def body(employee, status="P", hours=0, day=PAST, **extra):
    return {
        "date_bs": bs(day),
        "employee_id": employee.id,
        "status": status,
        "ot_hours": hours,
        **extra,
    }


@pytest.fixture
def sign_in(client, db, login, make_user, world):
    """``h = await sign_in("owner", super_admin=True)``: an admin on the main branch."""

    async def _as(name="owner", *, super_admin=False, role="admin"):
        user = await make_user(name, role=Role(role))
        user.is_super_admin = super_admin
        branch = None if role == "admin" else world.main.id
        db.add(UserAccess(user_id=user.id, branch_id=branch))
        await db.flush()
        await login(name)
        return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}

    return _as


async def changes(db, employee):
    rows = await db.scalars(
        select(RecordChange)
        .where(RecordChange.employee_id == employee.id)
        .order_by(RecordChange.id)
    )
    return [(c.old_status, c.new_status, c.new_hours, c.is_override, c.reason) for c in rows]


async def past_record(db, employee, status="P", hours=0, day=PAST) -> Record:
    """A mark made long ago (its 24 hours are over)."""
    record = Record(
        employee_id=employee.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=employee.branch_id,
        source="manual",
        created_at=bsdate.utc_now() - timedelta(days=(TODAY - day).days),
    )
    db.add(record)
    await db.flush()
    return record


# ------------------------------------------------------------------------- the reason


@pytest.mark.parametrize("reason", [None, "", "   ", "ok", " a  b "])
async def test_a_past_change_without_a_reason_is_422(client, db, sign_in, world, reason):
    h = await sign_in(super_admin=True)
    anita = world.people["Anita"]
    await past_record(db, anita)
    extra = {} if reason is None else {"reason": reason}
    for response in (
        await client.post("/api/attendance/mark", json=body(anita, "A", **extra), headers=h),
        await client.delete(
            "/api/attendance/mark",
            params={"employee_id": anita.id, "date_bs": bs(PAST)} | extra,
            headers=h,
        ),
        await client.post(
            "/api/attendance/bulk-mark",
            json={"date_bs": bs(PAST), "branch_id": world.main.id, "employee_ids": [anita.id]}
            | extra,
            headers=h,
        ),
    ):
        assert response.status_code == 422, response.text
        assert response.json() == {
            "detail": "Give a reason for changing a past date (at least 5 characters).",
            "code": "reason_required",
            "field": "reason",
        }
    record = await db.scalar(select(Record).where(Record.employee_id == anita.id))
    assert record.status == "P" and await changes(db, anita) == []


async def test_a_past_change_with_a_reason_is_saved_and_logged(client, db, sign_in, world):
    h = await sign_in(super_admin=True)
    anita = world.people["Anita"]
    await past_record(db, anita)
    response = await client.post(
        "/api/attendance/mark",
        json=body(anita, "A", reason=f"  {REASON}  "),
        headers=h,
    )
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["previous"] == "P" and out["record"]["status"] == "A"
    assert out["record"]["marked_by"] == "owner" and out["record"]["locked"] is True
    assert await changes(db, anita) == [("P", "A", 0, True, REASON)]
    row = await db.scalar(select(RecordChange).where(RecordChange.employee_id == anita.id))
    assert row.changed_by is not None and row.changed_at is not None and row.date == PAST


async def test_super_admin_creates_changes_and_removes_on_a_past_day(client, db, sign_in, world):
    h = await sign_in(super_admin=True)
    bikash = world.people["Bikash"]
    created = await client.post(
        "/api/attendance/mark", json=body(bikash, "O", 3, reason=REASON), headers=h
    )
    assert created.status_code == 200 and created.json()["previous"] == "N"
    record = await db.scalar(select(Record).where(Record.employee_id == bikash.id))
    assert (record.date, record.status, record.overtime_hours) == (PAST, "O", 3)
    removed = await client.delete(
        "/api/attendance/mark",
        params={
            "employee_id": bikash.id,
            "date_bs": bs(PAST),
            "reason": "Entered for the wrong day",
        },
        headers=h,
    )
    assert removed.status_code == 200 and removed.json()["previous"] == "O"
    assert await db.scalar(select(Record).where(Record.employee_id == bikash.id)) is None
    assert await changes(db, bikash) == [
        (None, "O", 3, True, REASON),
        ("O", None, 0, True, "Entered for the wrong day"),
    ]


async def test_super_admin_bulk_marks_a_past_day_with_a_reason(client, db, sign_in, world):
    h = await sign_in(super_admin=True)
    anita, chandra = world.people["Anita"], world.people["Chandra"]
    await past_record(db, anita, "A")
    response = await client.post(
        "/api/attendance/bulk-mark",
        json={
            "date_bs": bs(PAST),
            "branch_id": world.main.id,
            "department_id": world.store.id,
            "reason": REASON,
        },
        headers=h,
    )
    assert response.status_code == 200, response.text
    assert response.json()["marked"] == [{"employee_id": chandra.id, "name": "Chandra"}]
    assert response.json()["skipped"] == [anita.id]
    assert await changes(db, chandra) == [(None, "P", 0, True, REASON)]
    assert await changes(db, anita) == []


async def test_the_rules_of_a_mark_still_hold(client, db, sign_in, world):
    """An override lifts the lock, nothing else: no A on a Saturday, hours only with O."""
    h = await sign_in(super_admin=True)
    anita = world.people["Anita"]
    saturday = TODAY - timedelta(days=1)
    while bsdate.weekday_index(saturday) != 6:
        saturday -= timedelta(days=1)
    absent = await client.post(
        "/api/attendance/mark", json=body(anita, "A", day=saturday, reason=REASON), headers=h
    )
    assert absent.status_code == 422 and "weekly off" in absent.json()["detail"]
    hours = await client.post(
        "/api/attendance/mark", json=body(anita, "P", 2, reason=REASON), headers=h
    )
    assert hours.status_code == 422


# ----------------------------------------------------------------------- today and future


async def test_today_is_ordinary_marking_for_the_super_admin(client, db, sign_in, world):
    h = await sign_in(super_admin=True)
    anita = world.people["Anita"]
    response = await client.post("/api/attendance/mark", json=body(anita, day=TODAY), headers=h)
    assert response.status_code == 200, response.text
    again = await client.post(
        "/api/attendance/mark", json=body(anita, "A", day=TODAY, reason=REASON), headers=h
    )
    assert again.status_code == 200
    # Not overrides: nothing was locked, and a reason sent anyway is not kept.
    assert await changes(db, anita) == [(None, "P", 0, False, ""), ("P", "A", 0, False, "")]
    day = (await client.get("/api/attendance/day", params={"date_bs": bs(TODAY)})).json()
    assert day["lock"]["mode"] == "open" and day["lock"]["reason_required"] is False


async def test_a_future_day_is_403_for_the_super_admin_too(client, db, sign_in, world):
    h = await sign_in(super_admin=True)
    anita = world.people["Anita"]
    tomorrow = TODAY + timedelta(days=1)
    for response in (
        await client.post(
            "/api/attendance/mark", json=body(anita, day=tomorrow, reason=REASON), headers=h
        ),
        await client.delete(
            "/api/attendance/mark",
            params={"employee_id": anita.id, "date_bs": bs(tomorrow), "reason": REASON},
            headers=h,
        ),
        await client.post(
            "/api/attendance/bulk-mark",
            json={
                "date_bs": bs(tomorrow),
                "branch_id": world.main.id,
                "employee_ids": [anita.id],
                "reason": REASON,
            },
            headers=h,
        ),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "future_date"
    assert await db.scalar(select(Record)) is None


# ------------------------------------------------------------------- only the super admin


async def test_a_reason_does_not_help_an_ordinary_admin(client, db, sign_in, world):
    h = await sign_in("chief")
    anita = world.people["Anita"]
    await past_record(db, anita)
    for response in (
        await client.post("/api/attendance/mark", json=body(anita, "A", reason=REASON), headers=h),
        await client.post(
            "/api/attendance/mark",
            json=body(world.people["Bikash"], reason=REASON),
            headers=h,
        ),
        await client.delete(
            "/api/attendance/mark",
            params={"employee_id": anita.id, "date_bs": bs(PAST), "reason": REASON},
            headers=h,
        ),
        await client.post(
            "/api/attendance/bulk-mark",
            json={
                "date_bs": bs(PAST),
                "branch_id": world.main.id,
                "department_id": world.store.id,
                "reason": REASON,
            },
            headers=h,
        ),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "attendance_locked"
    assert await changes(db, anita) == []


async def test_the_day_list_tells_the_super_admin_it_is_an_override_day(client, db, sign_in, world):
    await sign_in(super_admin=True)
    await past_record(db, world.people["Anita"])
    day = (await client.get("/api/attendance/day", params={"date_bs": bs(PAST)})).json()
    assert day["lock"] == {
        "mode": "override",
        "is_today": False,
        "can_create": True,
        "reason_required": True,
        "date_label": bsdate.ad_to_bs(PAST).format(),
        "message": "Past date · changes are logged",
    }
    assert day["rows"][1]["record"]["locked"] is True  # a fact about the mark, whoever asks
