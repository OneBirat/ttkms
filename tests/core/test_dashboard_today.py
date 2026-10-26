"""GET /api/dashboard/today and /compare: everything the dashboard shows, for ONE branch -
attendance (active staff joined by today, P / O / A / not marked, the not-in list, Saturday =
weekly off) and payments today (a salary payment group counted once), with the permission rules;
compare = every branch side by side."""

from datetime import UTC, date, datetime

import pytest

from app.core import bsdate
from app.core.models import Branch, Department, Employee, EmployeeStatus
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import effective_access
from app.modules.attendance import services
from app.modules.attendance.models import Record
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource

pytestmark = pytest.mark.anyio

WEDNESDAY = date(2026, 10, 21)
SATURDAY = date(2026, 10, 24)


def _at(monkeypatch, day: date) -> None:
    monkeypatch.setattr(services, "now", lambda: datetime.combine(day, datetime.min.time(), UTC))


async def _world(db):
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store = Department(name="Store")
    db.add_all([main, second, store])
    await db.flush()
    people = {}
    for name, branch, joined, status in (
        ("Anita", main, date(2026, 1, 1), EmployeeStatus.active),
        ("Bikash", main, date(2026, 1, 1), EmployeeStatus.active),
        ("Chandra", main, date(2026, 1, 1), EmployeeStatus.active),
        ("Dipak", main, date(2026, 1, 1), EmployeeStatus.active),
        ("Late Laxmi", main, date(2027, 1, 1), EmployeeStatus.active),  # not joined yet
        ("Old Hari", main, date(2026, 1, 1), EmployeeStatus.inactive),
        ("Mina", second, date(2026, 1, 1), EmployeeStatus.active),
    ):
        e = Employee(
            full_name=name,
            branch_id=branch.id,
            department_id=store.id,
            joined_ad=joined,
            status=status,
        )
        db.add(e)
        await db.flush()
        people[name] = e
    return main, second, people


def _rec(e, day, status, hours=0):
    return Record(
        employee_id=e.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=e.branch_id,
        source="manual",
    )


def _pay(e, kind, amount, receipt, month=(2083, 6), group=None):
    return Payment(
        receipt_no=receipt,
        employee_id=e.id,
        branch_id=e.branch_id,
        kind=PaymentKind(kind),
        for_year=month[0],
        for_month=month[1],
        amount=amount,
        payment_mode_id=1,
        date=bsdate.today_ad(),
        source=PaymentSource.account,
        payment_group_id=group,
    )


async def _seed(db, people, day):
    db.add_all(
        [
            _rec(people["Anita"], day, "P"),
            _rec(people["Bikash"], day, "O", 3),
            _rec(people["Chandra"], day, "A"),
            _rec(people["Mina"], day, "P"),
        ]
    )
    # A salary payment group over two months = ONE payment; one advance; another branch's advance.
    first = _pay(people["Anita"], "salary", 30000, "SAL-0001", (2083, 5))
    db.add(first)
    await db.flush()
    first.payment_group_id = first.id
    db.add_all(
        [
            _pay(people["Anita"], "salary", 12000, "SAL-0001", (2083, 6), group=first.id),
            _pay(people["Bikash"], "advance", 2000, "ADV-0001"),
            _pay(people["Mina"], "advance", 700, "ADV-0002"),
        ]
    )
    await db.flush()


async def test_today_counts_only_the_branch_and_a_salary_group_once(
    client, db, make_user, login, monkeypatch
):
    main, second, people = await _world(db)
    _at(monkeypatch, WEDNESDAY)
    await _seed(db, people, WEDNESDAY)
    await make_user("admin", role="admin")
    await login("admin")
    body = (await client.get("/api/dashboard/today")).json()
    assert body["branch"] == {"id": main.id, "name": "Main branch"}
    att = body["attendance"]
    # Anita, Bikash, Chandra, Dipak: joined, active, Main (not Late Laxmi, Old Hari or Mina).
    assert (att["staff"], att["present"], att["overtime"], att["overtime_hours"]) == (4, 1, 1, 3)
    assert (att["absent"], att["not_marked"], att["weekly_off"]) == (1, 1, False)
    assert [p["name"] for p in att["not_in"]] == ["Dipak"]
    assert att["not_in"][0]["department"] == "Store"
    pay = body["payments"]
    assert (pay["count"], pay["paid"], pay["salary"], pay["advances"]) == (2, 44000, 42000, 2000)
    group = next(p for p in pay["payments"] if p["kind"] == "salary")
    assert group["amount"] == 42000 and group["months"] == 2 and group["name"] == "Anita"

    # Another branch, asked for explicitly (see_other_branches): only its own numbers.
    other = (await client.get(f"/api/dashboard/today?branch_id={second.id}")).json()
    assert other["branch"]["name"] == "Branch 2"
    assert (other["attendance"]["staff"], other["attendance"]["present"]) == (1, 1)
    assert (other["payments"]["count"], other["payments"]["paid"]) == (1, 700)
    # /api/today's paid count follows the same rule (the group once).
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts["payments_today"] == 2 and counts["paid_today"] == 44000


async def test_saturday_counts_only_staff_marked_as_working(
    client, db, make_user, login, monkeypatch
):
    main, second, people = await _world(db)
    _at(monkeypatch, SATURDAY)
    db.add(_rec(people["Bikash"], SATURDAY, "O", 4))
    await db.flush()
    await make_user("admin", role="admin")
    await login("admin")
    att = (await client.get("/api/dashboard/today")).json()["attendance"]
    assert att["weekly_off"] is True
    assert (att["staff"], att["present"], att["overtime"], att["overtime_hours"]) == (1, 0, 1, 4)
    assert (att["absent"], att["not_marked"], att["not_in"]) == (0, 0, [])


async def test_sections_follow_permissions_and_staff_get_their_own_branch(
    client, db, make_user, login, monkeypatch
):
    main, second, people = await _world(db)
    _at(monkeypatch, WEDNESDAY)
    await _seed(db, people, WEDNESDAY)
    clerk = await make_user("clerk", role="staff")  # mark_attendance only
    db.add(UserAccess(user_id=clerk.id, branch_id=second.id, access=None))
    await db.flush()
    await login("clerk")
    body = (await client.get(f"/api/dashboard/today?branch_id={main.id}")).json()
    assert body["branch"]["name"] == "Branch 2"  # ?branch_id= ignored without the switch
    assert body["attendance"]["staff"] == 1 and body["payments"] is None  # no salary_advances
    await client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]},
    )
    cashier = await make_user("cashier", role="staff")
    db.add(
        UserAccess(
            user_id=cashier.id,
            branch_id=main.id,
            access=effective_access("staff", {"mark_attendance": False, "salary_advances": True}),
        )
    )
    await db.flush()
    await login("cashier")
    body = (await client.get("/api/dashboard/today")).json()
    assert body["attendance"] is None and body["payments"]["paid"] == 44000


async def test_compare_is_one_entry_per_branch_and_admin_only(
    client, db, make_user, login, monkeypatch
):
    main, second, people = await _world(db)
    _at(monkeypatch, WEDNESDAY)
    await _seed(db, people, WEDNESDAY)
    await make_user("admin", role="admin")
    await login("admin")
    before = (await client.get("/api/auth/me")).json()["active_branch"]
    body = (await client.get("/api/dashboard/compare")).json()
    # Side by side, A-Z, each with its own numbers - no total anywhere.
    assert [b["branch"]["name"] for b in body["branches"]] == ["Branch 2", "Main branch"]
    b2, m = body["branches"]
    assert (b2["attendance"]["staff"], b2["payments"]["paid"]) == (1, 700)
    assert (m["attendance"]["staff"], m["payments"]["paid"], m["payments"]["count"]) == (
        4,
        44000,
        2,
    )
    assert set(body) == {"date", "date_bs", "branches"}
    # Looking does not switch.
    assert (await client.get("/api/auth/me")).json()["active_branch"] == before
    await client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]},
    )
    boss = await make_user("boss", role="manager")
    db.add(UserAccess(user_id=boss.id, branch_id=main.id, access=None))
    await db.flush()
    await login("boss")
    assert (await client.get("/api/dashboard/compare")).status_code == 403
