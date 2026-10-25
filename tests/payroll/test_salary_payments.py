"""POST /salary-payments: one amount settles the salary due oldest month first, in one transaction -
one salary row per month sharing one receipt number and payment_group_id. Over the total due is a
422 ``over_total``; the running month only takes what is earned so far. Voiding any row voids the
group and restores the dues. "Cleared {date}" = the day of the payment that brought the month's
paid total up to its net pay."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.core.models import AuditLog, Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.payroll.models import Payment, PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)


async def _anita(db):
    branch, dept = Branch(name="Main branch"), Department(name="Store")
    db.add_all([branch, dept])
    await db.flush()
    anita = Employee(
        full_name="Anita", branch_id=branch.id, department_id=dept.id, joined_ad=date(2026, 1, 1)
    )
    db.add(anita)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=anita.id,
            pay_type=PayType.monthly,
            basic=30000,
            ot_rate=125,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()
    return branch, anita


async def _admin(client, make_user, login):
    await make_user("admin", role="admin")
    await login("admin")
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _dues(client, anita):
    response = await client.get(f"/api/payroll/employees/{anita.id}/salary-dues")
    assert response.status_code == 200, response.text
    return response.json()


async def _pay_salary(client, h, anita, amount, **extra):
    return await client.post(
        "/api/payroll/salary-payments",
        json={"employee_id": anita.id, "amount": amount, **extra},
        headers=h,
    )


def _key(m):
    return (m["month"]["bs_year"], m["month"]["bs_month"])


async def test_dues_list_oldest_first_with_the_running_month_so_far(client, db, make_user, login):
    _, anita = await _anita(db)
    await _admin(client, make_user, login)
    dues = await _dues(client, anita)
    months = dues["months"]
    # The kept window: five completed months of 30,000 and the running month so far.
    assert [_key(m) for m in months][-1] == CURRENT and months[-1]["in_progress"] is True
    assert [_key(m) for m in months] == sorted(_key(m) for m in months)
    past = [m for m in months if not m["in_progress"]]
    assert len(past) == 5 and all(m["due"] == m["net"] == 30000 for m in past)
    running = months[-1]
    assert 0 < running["due"] == running["net"] <= 30000
    assert dues["past_due"] == 150000
    assert dues["total_due"] == 150000 + running["due"] and dues["running_due"] == running["due"]
    assert all(m["cleared_on"] is None for m in months)


async def test_one_amount_is_split_oldest_first_under_one_receipt(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    before = await _dues(client, anita)
    first, second = before["months"][0], before["months"][1]

    paid = await _pay_salary(client, h, anita, 45000, payment_mode_id=1, note="Dashain")
    assert paid.status_code == 201, paid.text
    body = paid.json()
    assert body["amount"] == 45000 and body["receipt_no"].startswith("SAL-")
    assert [(_key(s), s["amount"]) for s in body["split"]] == [
        (_key(first), 30000),
        (_key(second), 15000),
    ]
    assert body["split"][0]["due_after"] == 0 and body["split"][0]["cleared_on"]["bs"] == (
        TODAY.isoformat()
    )
    assert body["split"][1]["due_after"] == 15000 and body["split"][1]["cleared_on"] is None
    assert body["total_due_after"] == before["total_due"] - 45000

    # One row per month, one receipt number, one group (the first row's id).
    rows = list(
        await db.scalars(
            select(Payment).where(Payment.employee_id == anita.id).order_by(Payment.id)
        )
    )
    assert len(rows) == 2
    assert {r.receipt_no for r in rows} == {body["receipt_no"]}
    assert {r.payment_group_id for r in rows} == {rows[0].id} == {body["payment_group_id"]}
    assert all(r.kind.value == "salary" and r.note == "Dashain" for r in rows)

    # The month ledgers use the per-month rows; the cleared month says when.
    ledger = (await client.get(f"/api/payroll/employees/{anita.id}/ledger")).json()
    by_month = {(m["month"]["bs_year"], m["month"]["bs_month"]): m for m in ledger}
    assert by_month[_key(first)]["due"] == 0
    assert by_month[_key(first)]["cleared_on"]["bs"] == TODAY.isoformat()
    assert by_month[_key(second)]["due"] == 15000 and by_month[_key(second)]["cleared_on"] is None

    # The payment register shows the group as one entry with its split.
    start = bsdate.BSDate(*bsdate.shift_month(*CURRENT, -1), 1).isoformat()
    register = (
        await client.get("/api/payroll/payments", params={"from": start, "to": TODAY.isoformat()})
    ).json()
    assert len(register["rows"]) == 1 and register["totals"]["count"] == 1
    entry = register["rows"][0]
    assert entry["payment"]["amount"] == 45000 and register["totals"]["amount"] == 45000
    assert [(_key(x), x["amount"]) for x in entry["split"]] == [
        (_key(first), 30000),
        (_key(second), 15000),
    ]

    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "pay_salary"))
    assert [x["amount"] for x in audit.data["after"]["split"]] == [30000, 15000]

    # The next payment gets its own receipt number.
    nxt = (await _pay_salary(client, h, anita, 1000)).json()
    assert nxt["receipt_no"] != body["receipt_no"] and [s["amount"] for s in nxt["split"]] == [1000]


async def test_exact_total_clears_everything_and_more_is_refused(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    dues = await _dues(client, anita)
    total = dues["total_due"]

    over = await _pay_salary(client, h, anita, total + 1)
    assert over.status_code == 422
    err = over.json()
    assert err["code"] == "over_total" and err["cap"] == total
    assert "can only be paid up to what is earned so far" in err["detail"]
    assert await db.scalar(select(Payment.id).where(Payment.employee_id == anita.id)) is None

    paid = await _pay_salary(client, h, anita, total)
    assert paid.status_code == 201, paid.text
    body = paid.json()
    # The running month takes exactly what is earned so far, no more.
    assert body["split"][-1]["amount"] == dues["running_due"]
    assert _key(body["split"][-1]) == CURRENT
    assert body["total_due_after"] == 0
    assert all(s["cleared_on"]["bs"] == TODAY.isoformat() for s in body["split"])
    after = await _dues(client, anita)
    assert after["total_due"] == 0 and after["months"][-1]["due"] == 0
    again = await _pay_salary(client, h, anita, 1)
    assert again.status_code == 422 and again.json()["cap"] == 0


async def test_amount_and_mode_checks(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    assert (await _pay_salary(client, h, anita, 0)).status_code == 422
    assert (await _pay_salary(client, h, anita, -5)).status_code == 422
    unknown = await _pay_salary(client, h, anita, 100, payment_mode_id=9999)
    assert unknown.status_code == 422
    future = (bsdate.today_ad() + timedelta(days=1)).isoformat()
    assert (await _pay_salary(client, h, anita, 100, date=future)).status_code == 422


async def test_void_one_row_voids_the_group_and_restores_dues(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    before = await _dues(client, anita)
    body = (await _pay_salary(client, h, anita, 50000)).json()
    assert len(body["payments"]) == 2
    second = body["payments"][1]
    voided = await client.post(
        f"/api/payroll/payments/{second['id']}/void", json={"reason": "Test entry"}, headers=h
    )
    assert voided.status_code == 200, voided.text
    rows = list(await db.scalars(select(Payment).where(Payment.employee_id == anita.id)))
    for row in rows:
        await db.refresh(row)
    assert all(r.voided_at is not None and r.void_reason == "Test entry" for r in rows)
    after = await _dues(client, anita)
    assert after["total_due"] == before["total_due"]
    assert [m["due"] for m in after["months"]] == [m["due"] for m in before["months"]]
    assert all(m["cleared_on"] is None for m in after["months"])
    again = await client.post(
        f"/api/payroll/payments/{body['payments'][0]['id']}/void",
        json={"reason": "Again"},
        headers=h,
    )
    assert again.status_code == 409


async def test_cleared_date_is_the_payment_that_reached_the_net(client, db, make_user, login):
    """Three payments for one month on three days: cleared on the one that reached 30,000; void
    it and the month is open again until a new payment closes it."""
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    month = (await _dues(client, anita))["months"][0]
    year, mon = _key(month)
    today = bsdate.today_ad()
    days = [today - timedelta(days=3), today - timedelta(days=2), today - timedelta(days=1)]

    async def pay(amount, day):
        r = await client.post(
            "/api/payroll/payments",
            json={
                "employee_id": anita.id,
                "kind": "salary",
                "amount": amount,
                "for_year": year,
                "for_month": mon,
                "date": day.isoformat(),
            },
            headers=h,
        )
        assert r.status_code == 201, r.text
        return r.json()["payment"]

    await pay(10000, days[0])
    reached = await pay(20000, days[1])
    oldest = (await _dues(client, anita))["months"][0]
    # Fully paid months before the oldest due one drop off the front of the list.
    assert _key(oldest) != (year, mon)
    ledger = (await client.get(f"/api/payroll/employees/{anita.id}/ledger/{year}-{mon:02d}")).json()
    assert ledger["due"] == 0 and ledger["cleared_on"]["ad"] == days[1].isoformat()

    await client.post(
        f"/api/payroll/payments/{reached['id']}/void", json={"reason": "Wrong"}, headers=h
    )
    ledger = (await client.get(f"/api/payroll/employees/{anita.id}/ledger/{year}-{mon:02d}")).json()
    assert ledger["due"] == 20000 and ledger["cleared_on"] is None

    # The settlement pays the oldest month first and clears it today.
    body = (await _pay_salary(client, h, anita, 20000)).json()
    assert [(_key(s), s["amount"]) for s in body["split"]] == [((year, mon), 20000)]
    assert body["split"][0]["cleared_on"]["ad"] == today.isoformat()
    dues = await _dues(client, anita)
    assert all(_key(m) != (year, mon) for m in dues["months"])


async def test_needs_salary_advances_and_the_branch(client, db, make_user, login):
    branch, anita = await _anita(db)
    other = Branch(name="Branch 2")
    db.add(other)
    await db.flush()
    access = {
        "mark_attendance": True,
        "view_attendance_report": True,
        "manage_employees": True,
        "salary_advances": False,
    }
    clerk = await make_user("clerk", role="manager")
    db.add(UserAccess(user_id=clerk.id, branch_id=branch.id, access=access))
    away = await make_user("away", role="manager")
    db.add(
        UserAccess(user_id=away.id, branch_id=other.id, access={**access, "salary_advances": True})
    )
    await db.flush()

    await login("clerk")
    h = {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}
    assert (await client.get(f"/api/payroll/employees/{anita.id}/salary-dues")).status_code == 403
    assert (await _pay_salary(client, h, anita, 100)).status_code == 403

    await client.post("/api/auth/logout", headers=h)
    await login("away")
    h = {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}
    assert (await _pay_salary(client, h, anita, 100)).status_code in (403, 404)
    assert await db.scalar(select(Payment.id).where(Payment.employee_id == anita.id)) is None
