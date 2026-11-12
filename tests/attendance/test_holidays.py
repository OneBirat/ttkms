"""The holiday calendar: only the super admin writes, only for today or later ("today" is the
frozen Kathmandu day of the test run), a holiday whose day has passed is locked, no two
holidays share a date and a branch, a branch only gets its own. And what a holiday does to the
day list, the report and the dashboard counts."""

from datetime import timedelta

import pytest

from app.core import bsdate
from app.modules.attendance import contract, services
from app.modules.attendance.models import Holiday, HolidayBranch, Record

pytestmark = pytest.mark.anyio

TODAY = services.today()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
LATER = TODAY + timedelta(days=9)
URL = "/api/attendance/holidays"


async def _sign_in(client, db, make_user, login, name="owner", super_admin=True, branch=None):
    user = await make_user(name, role="admin")
    user.is_super_admin = super_admin
    if branch is not None:
        user.active_branch_id = branch.id
    await db.flush()
    await login(name)
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


def _body(day=TODAY, name="Tihar", **extra):
    return {"date": day.isoformat(), "name": name, **extra}


async def _past(db, day, name="Dashain", branches=(), is_paid=True):
    """A holiday on a past day can only come from the database (the API refuses to make one)."""
    holiday = Holiday(
        date=day,
        name=name,
        all_branches=not branches,
        is_paid=is_paid,
        branches=[HolidayBranch(branch_id=b.id) for b in branches],
    )
    db.add(holiday)
    await db.flush()
    return holiday


async def _list(client, start=None, end=None, **params):
    response = await client.get(
        URL,
        params={
            "from": (start or YESTERDAY - timedelta(days=40)).isoformat(),
            "to": (end or LATER + timedelta(days=40)).isoformat(),
            **params,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_create_for_today_and_read_it_back(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login)
    created = await client.post(URL, json=_body(name="  Tihar   holiday "), headers=h)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["date"] == TODAY.isoformat() and body["date_bs"] == bsdate.today_bs().isoformat()
    assert body["name"] == "Tihar holiday" and body["weekday"] == bsdate.weekday_index(TODAY)
    assert (body["all_branches"], body["branch_ids"], body["is_paid"]) == (True, [], True)
    assert body["locked"] is False
    listed = await _list(client)
    assert listed["today"] == TODAY.isoformat()  # the server's Kathmandu day
    assert [x["id"] for x in listed["holidays"]] == [body["id"]]
    # A later day works too; anyone signed in may read.
    assert (await client.post(URL, json=_body(LATER, "Chhath"), headers=h)).status_code == 201
    await client.post("/api/auth/logout", headers=h)
    await make_user("clerk", role="staff")
    await login("clerk")
    assert len((await _list(client))["holidays"]) == 2


async def test_a_past_date_and_bad_input_are_422(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login)
    past = await client.post(URL, json=_body(YESTERDAY), headers=h)
    assert past.status_code == 422 and past.json()["field"] == "date"
    blank = await client.post(URL, json=_body(name="   "), headers=h)
    assert blank.status_code == 422 and blank.json()["field"] == "name"
    no_branch = await client.post(URL, json=_body(all_branches=False, branch_ids=[]), headers=h)
    assert no_branch.status_code == 422 and no_branch.json()["field"] == "branch_ids"
    unknown = await client.post(URL, json=_body(all_branches=False, branch_ids=[99999]), headers=h)
    assert unknown.status_code == 422 and unknown.json()["field"] == "branch_ids"
    assert (await _list(client))["holidays"] == []


async def test_only_the_super_admin_writes(client, db, make_user, login, world):
    existing = await _past(db, TOMORROW, "Tihar")
    h = await _sign_in(client, db, make_user, login, name="admin", super_admin=False)
    assert (await client.post(URL, json=_body(LATER), headers=h)).status_code == 403
    assert (
        await client.patch(f"{URL}/{existing.id}", json={"name": "Other"}, headers=h)
    ).status_code == 403
    assert (await client.delete(f"{URL}/{existing.id}", headers=h)).status_code == 403
    listed = (await _list(client))["holidays"]
    assert [x["name"] for x in listed] == ["Tihar"]  # an admin can still read


async def test_a_past_holiday_is_locked_for_everyone(client, db, make_user, login, world):
    old = await _past(db, YESTERDAY)
    h = await _sign_in(client, db, make_user, login)
    listed = (await _list(client))["holidays"]
    assert [(x["id"], x["locked"]) for x in listed] == [(old.id, True)]
    edited = await client.patch(f"{URL}/{old.id}", json={"name": "Renamed"}, headers=h)
    assert edited.status_code == 403 and "locked" in edited.json()["detail"]
    # Not even by moving it to a later day.
    moved = await client.patch(f"{URL}/{old.id}", json={"date": LATER.isoformat()}, headers=h)
    assert moved.status_code == 403
    assert (await client.delete(f"{URL}/{old.id}", headers=h)).status_code == 403
    await db.refresh(old)
    assert (old.name, old.date) == ("Dashain", YESTERDAY)


async def test_edit_and_delete_an_upcoming_holiday(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login)
    made = (await client.post(URL, json=_body(TOMORROW), headers=h)).json()
    # The new date must be today or later as well.
    back = await client.patch(
        f"{URL}/{made['id']}", json={"date": YESTERDAY.isoformat()}, headers=h
    )
    assert back.status_code == 422 and back.json()["field"] == "date"
    edited = await client.patch(
        f"{URL}/{made['id']}",
        json={
            "date": LATER.isoformat(),
            "name": "Bhai Tika",
            "all_branches": False,
            "branch_ids": [world.second.id],
            "is_paid": False,
        },
        headers=h,
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["date"], body["name"], body["is_paid"]) == (LATER.isoformat(), "Bhai Tika", False)
    assert (body["all_branches"], body["branch_ids"]) == (False, [world.second.id])
    assert body["branch_names"] == ["Branch 2"]
    # Only the fields sent change.
    renamed = await client.patch(f"{URL}/{made['id']}", json={"name": "Tika"}, headers=h)
    assert renamed.json()["branch_ids"] == [world.second.id] and renamed.json()["name"] == "Tika"
    assert (await client.delete(f"{URL}/{made['id']}", headers=h)).status_code == 204
    assert (await _list(client))["holidays"] == []
    assert (await client.delete(f"{URL}/{made['id']}", headers=h)).status_code == 404


async def test_overlap_is_409(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login)
    main, second = world.main.id, world.second.id
    one = await client.post(
        URL, json=_body(TOMORROW, "Main only", all_branches=False, branch_ids=[main]), headers=h
    )
    assert one.status_code == 201, one.text
    # Another branch on the same date is fine; the same branch, or all branches, is not.
    other = await client.post(
        URL, json=_body(TOMORROW, "Second only", all_branches=False, branch_ids=[second]), headers=h
    )
    assert other.status_code == 201, other.text
    same = await client.post(
        URL, json=_body(TOMORROW, "Again", all_branches=False, branch_ids=[main, second]), headers=h
    )
    assert same.status_code == 409 and same.json()["code"] == "holiday_overlap"
    everyone = await client.post(URL, json=_body(TOMORROW, "Everyone"), headers=h)
    assert everyone.status_code == 409
    # An all-branches holiday overlaps everything on its date ...
    assert (await client.post(URL, json=_body(LATER, "Chhath"), headers=h)).status_code == 201
    scoped = await client.post(
        URL, json=_body(LATER, "Local", all_branches=False, branch_ids=[second]), headers=h
    )
    assert scoped.status_code == 409
    # ... also when an edit moves a holiday onto it; saving a holiday as it is does not clash.
    moved = await client.patch(
        f"{URL}/{one.json()['id']}", json={"date": LATER.isoformat()}, headers=h
    )
    assert moved.status_code == 409
    kept = await client.patch(f"{URL}/{one.json()['id']}", json={"name": "Main branch"}, headers=h)
    assert kept.status_code == 200


async def test_a_branch_holiday_is_only_for_its_branch(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login, branch=world.main)
    made = await client.post(
        URL,
        json=_body(TODAY, "Local fair", all_branches=False, branch_ids=[world.second.id]),
        headers=h,
    )
    assert made.status_code == 201, made.text
    assert (await _list(client, branch_id=world.main.id))["holidays"] == []
    assert [x["name"] for x in (await _list(client, branch_id=world.second.id))["holidays"]] == [
        "Local fair"
    ]
    assert len((await _list(client))["holidays"]) == 1  # no branch asked: every holiday
    # The day list of Main shows no holiday; Branch 2's does, and nobody there needs a mark.
    today_bs = bsdate.today_bs().isoformat()
    main_day = (await client.get("/api/attendance/day", params={"date_bs": today_bs})).json()
    assert main_day["holiday"] is None and main_day["day"]["holiday"] is None
    second_day = (
        await client.get(
            "/api/attendance/day", params={"date_bs": today_bs, "branch": world.second.id}
        )
    ).json()
    assert second_day["holiday"]["name"] == "Local fair" and second_day["holiday"]["is_paid"]
    # Marking still works on a holiday.
    marked = await client.post(
        "/api/attendance/mark",
        json={"date_bs": today_bs, "employee_id": world.people["Anita"].id, "status": "P"},
        headers=h,
    )
    assert marked.status_code == 200, marked.text


async def test_report_shows_the_holiday_as_its_own_status(client, db, make_user, login, world):
    start, end = bsdate.bs_month_range(*bsdate.shift_month(*_month(TODAY), -1))
    workdays = [
        start + timedelta(days=i)
        for i in range((end - start).days + 1)
        if not services.is_weekly_off(start + timedelta(days=i))
    ]
    saturday = next(
        start + timedelta(days=i)
        for i in range((end - start).days + 1)
        if services.is_weekly_off(start + timedelta(days=i))
    )
    await _past(db, workdays[4], "Dashain")
    await _past(db, saturday, "Fair on a Saturday", branches=[world.main])
    anita = world.people["Anita"]
    db.add(
        Record(
            employee_id=anita.id,
            date=workdays[0],
            status="P",
            overtime_hours=0,
            branch_id=anita.branch_id,
            source="manual",
        )
    )
    await db.flush()
    await _sign_in(client, db, make_user, login, branch=world.main)
    previous = bsdate.shift_month(*_month(TODAY), -1)
    report = (
        await client.get(
            "/api/attendance/report", params={"bs_year": previous[0], "bs_month": previous[1]}
        )
    ).json()
    days = report["month"]["days"]
    row = next(r for r in report["rows"] if r["employee"]["name"] == "Anita")
    cells = {d["ad_date"]: c for d, c in zip(days, row["cells"], strict=True)}
    header = next(d for d in days if d["ad_date"] == workdays[4].isoformat())
    assert header["holiday"]["name"] == "Dashain"
    # Not absent, not "not marked": its own status - also on a Saturday.
    assert cells[workdays[4].isoformat()]["status"] == "H"
    assert cells[workdays[4].isoformat()]["not_marked"] is False
    assert cells[saturday.isoformat()]["status"] == "H"
    assert cells[workdays[5].isoformat()] == {**cells[workdays[5].isoformat()], "status": "N"}
    totals = row["totals"]
    assert totals["holidays"] == 2 and totals["absent"] == 0
    assert totals["not_marked"] == len(workdays) - 2  # all but the marked day and the holiday
    # The same paid days payroll counts (the Saturday holiday is a weekly off there).
    summary = await contract.ATTENDANCE_SUMMARY.for_month(anita.id, *previous)
    assert summary.paid_days == totals["paid_days"]
    assert (summary.holidays, summary.not_marked) == (1, totals["not_marked"])


def _month(day):
    bs = bsdate.ad_to_bs(day)
    return bs.year, bs.month


async def test_nobody_is_not_marked_on_a_holiday(client, db, make_user, login, world):
    h = await _sign_in(client, db, make_user, login, branch=world.main)
    before = (await client.get("/api/today")).json()["counts"]
    if not services.is_weekly_off(TODAY):
        assert before["not_marked"] == 3
    assert (await client.post(URL, json=_body(), headers=h)).status_code == 201
    after = (await client.get("/api/today")).json()["counts"]
    assert after["not_marked"] == 0 and after["total"] == before["total"]


def test_summary_rules_for_holidays():
    """Pure: Kartik 2083 seen after it closed. 19 Oct P, 20 Oct O, 21 Oct A, 2 Nov A."""
    from datetime import date

    start, end = bsdate.bs_month_range(2083, 7)
    joined, later = date(2026, 1, 1), date(2026, 12, 1)

    def rec(day, status="P", hours=0):
        return Record(employee_id=1, date=day, status=status, overtime_hours=hours, branch_id=1)

    records = [
        rec(date(2026, 10, 19)),
        rec(date(2026, 10, 20), "O", 2),
        rec(date(2026, 10, 21), "A"),
    ]
    plain = contract.summarise(start, end, later, joined, records)
    assert (plain.not_marked, plain.absent, plain.holidays, plain.paid_days) == (23, 1, 0, 6)
    off = {
        date(2026, 10, 22): True,  # paid, no mark: a paid day, not "not marked"
        date(2026, 10, 21): True,  # paid, marked absent: no absence
        date(2026, 10, 20): True,  # paid, worked overtime: still overtime
        date(2026, 10, 23): False,  # unpaid, no mark: the day is cut, but not "not marked"
        date(2026, 10, 24): True,  # a Saturday: stays a weekly off
    }
    s = contract.summarise(start, end, later, joined, records, None, off)
    assert (s.holidays, s.unpaid_holidays, s.absent, s.not_marked) == (2, 1, 0, 21)
    assert (s.present, s.overtime_days, s.overtime_hours, s.weekly_off) == (1, 1, 2, 4)
    assert s.paid_days == 1 + 1 + 4 + 2
    # A holiday that has not come yet (seen on 21 Oct) changes nothing.
    early = contract.summarise(start, end, date(2026, 10, 21), joined, records, None, off)
    assert (early.holidays, early.unpaid_holidays) == (1, 0)
