"""The attendance lock for everyone with mark_attendance (Admin and Manager included): new
marks for today only, a mark changeable for 24 hours from when it was FIRST saved, bulk for
today only, nothing in the future. Enforced by the API: 403 ``attendance_locked`` /
``future_date``."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.modules.attendance import services
from app.modules.attendance.models import Record, RecordChange

pytestmark = pytest.mark.anyio

NOW = bsdate.utc_now()  # the suite's frozen clock: mid-morning in Kathmandu
TODAY = bsdate.today_ad()
YESTERDAY = TODAY - timedelta(days=1)


def bs(day: date) -> str:
    return bsdate.ad_to_bs(day).isoformat()


def label(day: date) -> str:
    return bsdate.ad_to_bs(day).format()


def locked_body(day: date) -> dict:
    return {
        "detail": f"Attendance for {label(day)} is locked. Only the super admin can change it.",
        "code": "attendance_locked",
        "date_bs": bs(day),
    }


@pytest.fixture
def clock(monkeypatch):
    """``clock(hours=23)`` moves the server clock that far past the frozen now;
    ``clock(at=datetime)`` sets it."""

    def _set(at: datetime | None = None, **delta) -> datetime:
        moment = at or NOW + timedelta(**delta)
        monkeypatch.setattr(services, "now", lambda: moment)
        return moment

    return _set


@pytest.fixture
def api(client, login, user_in, world):
    """``h = await api("boss", "manager")`` signs in a user of the main branch."""

    async def _as(name="boss", role="manager", branch="main"):
        await user_in(name, role, world.main if branch == "main" else None)
        await login(name)
        return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}

    return _as


def mark(employee, status="P", hours=0, day=TODAY):
    return {"date_bs": bs(day), "employee_id": employee.id, "status": status, "ot_hours": hours}


async def post_mark(client, h, *args, **kwargs):
    return await client.post("/api/attendance/mark", json=mark(*args, **kwargs), headers=h)


async def clear(client, h, employee, day=TODAY):
    return await client.delete(
        "/api/attendance/mark", params={"employee_id": employee.id, "date_bs": bs(day)}, headers=h
    )


async def bulk(client, h, world, day=TODAY):
    return await client.post(
        "/api/attendance/bulk-mark",
        json={"date_bs": bs(day), "branch_id": world.main.id, "department_id": world.store.id},
        headers=h,
    )


# ----------------------------------------------------------------------------------- today


async def test_a_manager_marks_today(client, db, api, world):
    h = await api()
    anita = world.people["Anita"]
    response = await post_mark(client, h, anita)
    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert record["locked"] is False
    created = datetime.fromisoformat(record["created_at"])
    assert created == NOW
    assert datetime.fromisoformat(record["editable_until"]) == NOW + timedelta(hours=24)
    day = (await client.get("/api/attendance/day", params={"date_bs": bs(TODAY)})).json()
    assert day["lock"] == {
        "mode": "open",
        "is_today": True,
        "can_create": True,
        "reason_required": False,
        "date_label": label(TODAY),
        "message": "",
    }
    assert (await bulk(client, h, world)).status_code == 200


# ------------------------------------------------------------------------- the 24 hours


async def test_edit_at_23_hours_is_fine_at_24_hours_and_a_minute_it_is_locked(
    client, db, api, world, clock
):
    h = await api()
    anita = world.people["Anita"]
    assert (await post_mark(client, h, anita)).status_code == 200

    clock(hours=23)  # tomorrow morning: the mark is yesterday's but not yet 24 hours old
    assert services.today() == TODAY + timedelta(days=1)
    edited = await post_mark(client, h, anita, "O", 2)
    assert edited.status_code == 200, edited.text
    assert edited.json()["record"]["status"] == "O" and edited.json()["record"]["locked"] is False

    clock(hours=24, minutes=1)
    late = await post_mark(client, h, anita, "A")
    assert late.status_code == 403 and late.json() == locked_body(TODAY)
    removed = await clear(client, h, anita)
    assert removed.status_code == 403 and removed.json() == locked_body(TODAY)
    record = await db.scalar(select(Record).where(Record.employee_id == anita.id))
    assert (record.status, record.overtime_hours) == ("O", 2)
    # Saving the same values again is refused too: the mark is closed.
    assert (await post_mark(client, h, anita, "O", 2)).status_code == 403


async def test_editing_does_not_extend_the_window(client, db, api, world, clock):
    h = await api()
    anita = world.people["Anita"]
    first = (await post_mark(client, h, anita)).json()["record"]
    clock(hours=23)
    second = (await post_mark(client, h, anita, "A")).json()["record"]
    assert second["created_at"] == first["created_at"]
    assert second["editable_until"] == first["editable_until"]
    record = await db.scalar(select(Record).where(Record.employee_id == anita.id))
    assert record.created_at == NOW
    # 24 h 01 min after the FIRST save - one hour after the edit - it is locked.
    clock(hours=24, minutes=1)
    assert (await post_mark(client, h, anita, "P")).status_code == 403
    assert (await clear(client, h, anita)).status_code == 403


async def test_a_mark_can_be_removed_inside_the_window_but_not_made_again_on_a_past_day(
    client, db, api, world, clock
):
    h = await api()
    anita = world.people["Anita"]
    await post_mark(client, h, anita)
    clock(hours=20)
    removed = await clear(client, h, anita)
    assert removed.status_code == 200 and removed.json()["previous"] == "P"
    again = await post_mark(client, h, anita)  # yesterday now, and nobody is marked
    assert again.status_code == 403 and again.json() == locked_body(TODAY)
    # Clearing a day without a mark changes nothing and stays a quiet 200.
    assert (await clear(client, h, anita)).json()["previous"] == "N"


# -------------------------------------------------------------------------------- past days


@pytest.mark.parametrize("role", ["admin", "manager", "staff"])
async def test_nobody_creates_a_mark_on_a_past_day(client, db, api, world, role):
    h = await api("someone", role)
    anita = world.people["Anita"]
    for day in (YESTERDAY, TODAY - timedelta(days=9)):
        response = await post_mark(client, h, anita, day=day)
        assert response.status_code == 403, response.text
        assert response.json() == locked_body(day)
    assert await db.scalar(select(Record).where(Record.employee_id == anita.id)) is None
    assert await db.scalar(select(RecordChange)) is None


async def test_bulk_mark_on_a_past_day_is_locked(client, db, api, world):
    h = await api("chief", "admin")
    response = await bulk(client, h, world, YESTERDAY)
    assert response.status_code == 403 and response.json() == locked_body(YESTERDAY)
    assert await db.scalar(select(Record)) is None


async def test_a_past_day_can_still_be_opened_and_says_it_is_locked(client, db, api, world, clock):
    h = await api()
    anita, chandra = world.people["Anita"], world.people["Chandra"]
    await post_mark(client, h, anita)
    clock(hours=10)
    await post_mark(client, h, chandra, "A")
    clock(hours=25)  # Anita's mark is 25 hours old, Chandra's 15
    response = await client.get("/api/attendance/day", params={"date_bs": bs(TODAY)})
    assert response.status_code == 200
    day = response.json()
    assert day["lock"] == {
        "mode": "locked",
        "is_today": False,
        "can_create": False,
        "reason_required": False,
        "date_label": label(TODAY),
        "message": f"Locked · {label(TODAY)} · Only the super admin can change past attendance.",
    }
    locked = {r["employee"]["name"]: r["record"] and r["record"]["locked"] for r in day["rows"]}
    assert locked == {"Anita": True, "Bikash": None, "Chandra": False}


# ----------------------------------------------------------------------------------- future


@pytest.mark.parametrize("role", ["admin", "manager", "staff"])
async def test_a_future_day_is_403_for_everyone(client, db, api, world, role):
    h = await api("someone", role)
    anita = world.people["Anita"]
    tomorrow = TODAY + timedelta(days=1)
    for response in (
        await post_mark(client, h, anita, day=tomorrow),
        await clear(client, h, anita, tomorrow),
        await bulk(client, h, world, tomorrow),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "future_date"
    assert await db.scalar(select(Record)) is None


# -------------------------------------------------------------------------------- timezone


async def test_half_past_midnight_in_nepal_is_already_the_new_day(client, db, api, world, clock):
    """00:30 in Kathmandu (UTC+5:45) is 18:45 UTC the evening before: the new BS day can be
    marked, and the day that ended 30 minutes ago can no longer get a new mark."""
    h = await api()
    anita, bikash = world.people["Anita"], world.people["Bikash"]
    the_day = TODAY + timedelta(days=1)
    clock(at=datetime(TODAY.year, TODAY.month, TODAY.day, 18, 45, tzinfo=UTC))
    assert services.today() == the_day
    assert bsdate.today_bs(services.now()).isoformat() == bs(the_day)
    new_day = await post_mark(client, h, anita, day=the_day)
    assert new_day.status_code == 200 and new_day.json()["date"] == the_day.isoformat()
    ended = await post_mark(client, h, bikash, day=TODAY)
    assert ended.status_code == 403 and ended.json() == locked_body(TODAY)
    # 23:59 Kathmandu (18:14 UTC) the same evening: still "today", the next day is the future.
    clock(at=datetime(TODAY.year, TODAY.month, TODAY.day, 18, 14, tzinfo=UTC))
    assert services.today() == TODAY
    assert (await post_mark(client, h, bikash, day=TODAY)).status_code == 200
    early = await post_mark(client, h, bikash, day=the_day)
    assert early.status_code == 403 and early.json()["code"] == "future_date"
