"""The history of a mark (attendance.record_changes): every create, change and removal is
logged with who, when, old value, new value, reason and override yes/no; the rows cannot be
edited or deleted; the report and the employee calendar flag a day the super admin changed."""

from datetime import date, timedelta

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from app.core import bsdate
from app.core.models import Role, User
from app.modules.admin.models import UserAccess
from app.modules.attendance.models import Record, RecordChange

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_ad()
BS_TODAY = bsdate.today_bs()
REASON = "Was on site, the list was missed"


def _workday(before: date) -> date:
    day = before - timedelta(days=1)
    while bsdate.weekday_index(day) == 6:
        day -= timedelta(days=1)
    return day


#: A day of the running BS month when there is one before today, else of the month before.
PAST = _workday(TODAY)
PAST_BS = bsdate.ad_to_bs(PAST)


def bs(day: date) -> str:
    return bsdate.ad_to_bs(day).isoformat()


@pytest.fixture
def sign_in(client, db, login, make_user, world):
    async def _as(name, *, super_admin=False, role="admin", full_name=None):
        user = await make_user(name, role=Role(role), full_name=full_name)
        user.is_super_admin = super_admin
        db.add(UserAccess(user_id=user.id, branch_id=None if role == "admin" else world.main.id))
        await db.flush()
        await login(name)
        return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}

    return _as


async def _old_mark(db, employee, status="P", hours=0, day=PAST):
    db.add(
        Record(
            employee_id=employee.id,
            date=day,
            status=status,
            overtime_hours=hours,
            branch_id=employee.branch_id,
            source="manual",
            created_at=bsdate.utc_now() - timedelta(days=3),
        )
    )
    await db.flush()


async def _mark(client, h, employee, status, hours=0, day=TODAY, **extra):
    response = await client.post(
        "/api/attendance/mark",
        json={
            "date_bs": bs(day),
            "employee_id": employee.id,
            "status": status,
            "ot_hours": hours,
            **extra,
        },
        headers=h,
    )
    assert response.status_code == 200, response.text
    return response


# --------------------------------------------------------------------------- what is logged


async def test_every_create_change_and_remove_is_logged(client, db, sign_in, world):
    h = await sign_in("boss", role="manager", full_name="Bina Boss")
    anita = world.people["Anita"]
    await _mark(client, h, anita, "P")
    await _mark(client, h, anita, "O", 3)
    await _mark(client, h, anita, "O", 3)  # nothing changed: nothing logged
    removed = await client.delete(
        "/api/attendance/mark", params={"employee_id": anita.id, "date_bs": bs(TODAY)}, headers=h
    )
    assert removed.status_code == 200
    history = await client.get(
        "/api/attendance/history", params={"employee_id": anita.id, "date_bs": bs(TODAY)}
    )
    assert history.status_code == 200, history.text
    body = history.json()
    assert body["employee_id"] == anita.id and body["date_bs"] == bs(TODAY)
    assert [
        (e["old_status"], e["old_hours"], e["new_status"], e["new_hours"]) for e in body["entries"]
    ] == [("N", 0, "P", 0), ("P", 0, "O", 3), ("O", 3, "N", 0)]
    for entry in body["entries"]:
        assert entry["by"] == "Bina Boss" and entry["via"] == "manual"
        assert entry["is_override"] is False and entry["reason"] == ""
        assert entry["at"] and entry["at_bs"]
    rows = (await db.scalars(select(RecordChange).order_by(RecordChange.id))).all()
    boss = await db.scalar(select(User).where(User.username == "boss"))
    assert {r.changed_by for r in rows} == {boss.id}
    assert {r.changed_by_name for r in rows} == {"Bina Boss"}


async def test_an_override_is_logged_with_its_reason(client, db, sign_in, world):
    h = await sign_in("owner", super_admin=True, full_name="Owner Shrestha")
    anita = world.people["Anita"]
    await _old_mark(db, anita)
    await _mark(client, h, anita, "A", day=PAST, reason=REASON)
    entries = (
        await client.get(
            "/api/attendance/history", params={"employee_id": anita.id, "date_bs": bs(PAST)}
        )
    ).json()["entries"]
    assert len(entries) == 1
    assert entries[0] | {"id": 0, "at": "", "at_bs": ""} == {
        "id": 0,
        "old_status": "P",
        "old_hours": 0,
        "new_status": "A",
        "new_hours": 0,
        "by": "Owner Shrestha",
        "at": "",
        "at_bs": "",
        "via": "manual",
        "is_override": True,
        "reason": REASON,
    }


async def test_bulk_marks_are_logged_one_row_each(client, db, sign_in, world):
    h = await sign_in("boss", role="manager")
    response = await client.post(
        "/api/attendance/bulk-mark",
        json={"date_bs": bs(TODAY), "branch_id": world.main.id, "department_id": world.store.id},
        headers=h,
    )
    assert len(response.json()["marked"]) == 2
    rows = (await db.scalars(select(RecordChange))).all()
    assert sorted((r.old_status, r.new_status, r.source, r.changed_by_name) for r in rows) == [
        (None, "P", "bulk", "Boss"),
        (None, "P", "bulk", "Boss"),
    ]


async def test_history_follows_the_branch_and_the_permissions(client, db, sign_in, world):
    await sign_in("boss", role="manager")
    mina = world.people["Mina"]  # Branch 2
    other = await client.get(
        "/api/attendance/history", params={"employee_id": mina.id, "date_bs": bs(TODAY)}
    )
    assert other.status_code == 403
    missing = await client.get(
        "/api/attendance/history", params={"employee_id": 999999, "date_bs": bs(TODAY)}
    )
    assert missing.status_code == 404
    bad = await client.get(
        "/api/attendance/history",
        params={"employee_id": world.people["Anita"].id, "date_bs": "2083-13-01"},
    )
    assert bad.status_code == 422


# ------------------------------------------------------------------------------ append-only


async def _one_change(db, world) -> RecordChange:
    anita = world.people["Anita"]
    change = RecordChange(
        employee_id=anita.id,
        date=PAST,
        old_status="P",
        new_status="A",
        source="manual",
        reason=REASON,
        is_override=True,
        changed_by_name="Owner Shrestha",
    )
    db.add(change)
    await db.flush()
    return change


@pytest.mark.parametrize(
    "statement",
    [
        lambda c: update(RecordChange).where(RecordChange.id == c.id).values(reason="tidied up"),
        lambda c: update(RecordChange).where(RecordChange.id == c.id).values(new_status="P"),
        lambda c: update(RecordChange).where(RecordChange.id == c.id).values(is_override=False),
        lambda c: update(RecordChange).where(RecordChange.id == c.id).values(changed_by_name="x"),
        lambda c: delete(RecordChange).where(RecordChange.id == c.id),
        lambda c: text("TRUNCATE attendance.record_changes"),
    ],
    ids=["edit-reason", "edit-status", "edit-override", "edit-name", "delete", "truncate"],
)
async def test_history_rows_cannot_be_edited_or_deleted(db, world, statement):
    change = await _one_change(db, world)
    with pytest.raises(DBAPIError, match="append-only"):
        async with db.begin_nested():
            await db.execute(statement(change))
    await db.refresh(change)
    assert (change.new_status, change.reason, change.is_override) == ("A", REASON, True)
    assert change.changed_by_name == "Owner Shrestha"


async def test_the_api_has_no_way_to_change_history(client, db, sign_in, world):
    h = await sign_in("owner", super_admin=True)
    for method in ("post", "put", "patch", "delete"):
        response = await getattr(client, method)("/api/attendance/history", headers=h)
        assert response.status_code == 405, method


async def test_a_removed_user_keeps_their_name_in_the_history(db, world, make_user):
    """The only UPDATE the trigger lets through is the foreign key's own SET NULL."""
    owner = await make_user("owner", full_name="Owner Shrestha")
    change = await _one_change(db, world)
    await db.execute(text("ALTER TABLE attendance.record_changes DISABLE TRIGGER USER"))
    await db.execute(
        update(RecordChange).where(RecordChange.id == change.id).values(changed_by=owner.id)
    )
    await db.execute(text("ALTER TABLE attendance.record_changes ENABLE TRIGGER USER"))
    await db.execute(delete(User).where(User.id == owner.id))
    await db.refresh(change)
    assert change.changed_by is None and change.changed_by_name == "Owner Shrestha"
    assert change.reason == REASON


# ------------------------------------------------------------ the dot in report and calendar


async def test_report_and_calendar_cells_carry_the_override(client, db, sign_in, world):
    h = await sign_in("owner", super_admin=True, full_name="Owner Shrestha")
    anita, bikash = world.people["Anita"], world.people["Bikash"]
    await _old_mark(db, anita)
    await _mark(client, h, anita, "A", day=PAST, reason="First correction")
    await _mark(client, h, anita, "O", 2, day=PAST, reason=REASON)  # the latest one shows
    await _mark(client, h, bikash, "P")  # today: an ordinary mark, no dot
    month = {"bs_year": PAST_BS.year, "bs_month": PAST_BS.month}
    report = (await client.get("/api/attendance/report", params=month)).json()
    index = PAST_BS.day - 1
    row = next(r for r in report["rows"] if r["employee"]["id"] == anita.id)
    cell = row["cells"][index]
    assert cell["status"] == "O" and cell["ot_hours"] == 2
    override = cell["override"]
    changed_on = bsdate.parse_bs(override["at_bs"]).format()  # the database's clock
    assert override | {"at": ""} == {
        "by": "Owner Shrestha",
        "at": "",
        "at_bs": override["at_bs"],
        "old_status": "A",
        "old_hours": 0,
        "new_status": "O",
        "new_hours": 2,
        "reason": REASON,
        "text": f"Changed by Owner Shrestha on {changed_on}: A → O2 · {REASON}",
    }
    others = [c for i, c in enumerate(row["cells"]) if i != index]
    assert all(c.get("override") is None for c in others)
    for other in report["rows"]:
        if other["employee"]["id"] != anita.id:
            assert all(c.get("override") is None for c in other["cells"])

    calendar = (
        await client.get(f"/api/attendance/employees/{anita.id}/month", params=month)
    ).json()
    assert calendar["cells"][index]["override"]["text"] == cell["override"]["text"]


async def test_a_removed_mark_keeps_its_dot(client, db, sign_in, world):
    h = await sign_in("owner", super_admin=True, full_name="Owner Shrestha")
    anita = world.people["Anita"]
    await _old_mark(db, anita, "O", 4)
    removed = await client.delete(
        "/api/attendance/mark",
        params={"employee_id": anita.id, "date_bs": bs(PAST), "reason": REASON},
        headers=h,
    )
    assert removed.status_code == 200
    calendar = (
        await client.get(
            f"/api/attendance/employees/{anita.id}/month",
            params={"bs_year": PAST_BS.year, "bs_month": PAST_BS.month},
        )
    ).json()
    cell = calendar["cells"][PAST_BS.day - 1]
    assert cell["status"] == "N"
    assert cell["override"]["text"].endswith(f": O4 → Not marked · {REASON}")
