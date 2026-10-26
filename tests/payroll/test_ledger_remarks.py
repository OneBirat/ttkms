"""Employee ledger (transactions): a bulk salary payment is ONE row on its payment date with the
group's total and its months; every payment has a server-written system remark that no client can
set or change; the human note is added / edited / cleared with PATCH .../note (salary_advances,
whole group, audit-logged)."""

from datetime import date

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.core.models import AuditLog, Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.payroll.models import Payment, PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()


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
    await make_user("admin", role="admin", full_name="Ram Admin")
    await login("admin")
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _transactions(client, anita):
    response = await client.get(f"/api/payroll/employees/{anita.id}/transactions")
    assert response.status_code == 200, response.text
    return response.json()


def _name(month: int) -> str:
    return bsdate.bs_month_name(month)


async def test_bulk_payment_is_one_ledger_row_with_its_months(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    dues = (await client.get(f"/api/payroll/employees/{anita.id}/salary-dues")).json()
    first, second = dues["months"][0]["month"], dues["months"][1]["month"]

    paid = await client.post(
        "/api/payroll/salary-payments",
        json={"employee_id": anita.id, "amount": 45000, "payment_mode_id": 1},
        headers=h,
    )
    assert paid.status_code == 201, paid.text
    receipt = paid.json()["receipt_no"]
    remark = (
        f"Bulk salary payment · {_name(first['bs_month'])} Rs 30,000 (cleared)"
        f" · {_name(second['bs_month'])} Rs 15,000 (part, Rs 15,000 left)"
    )
    rows = list(await db.scalars(select(Payment).where(Payment.employee_id == anita.id)))
    assert len(rows) == 2 and {r.system_remark for r in rows} == {remark}

    tx = await _transactions(client, anita)
    payments = [e for e in tx["entries"] if e["payment"] is not None]
    assert len(payments) == 1
    row = payments[0]
    assert row["type"] == "salary_paid" and row["paid"] == 45000
    assert row["date"]["bs"] == TODAY.isoformat()
    assert row["payment"]["amount"] == 45000
    assert row["payment"]["system_remark"] == remark
    assert row["details"] == f"Cash · by Ram Admin · receipt {receipt}"
    assert [
        (m["for_year"], m["for_month"], m["amount"], m["cleared"]) for m in row["group_months"]
    ] == [
        (first["bs_year"], first["bs_month"], 30000, True),
        (second["bs_year"], second["bs_month"], 15000, False),
    ]
    # The balance drops once, by the whole amount, on that row.
    i = tx["entries"].index(row)
    before = tx["entries"][i - 1]["balance"] if i else 0
    assert row["balance"] == before - 45000
    assert tx["entries"][-1]["balance"] == tx["totals"]["balance"]
    assert tx["totals"]["salary_payments"] == 45000 and tx["totals"]["salary_payment_count"] == 1

    # Earned rows name their month.
    salary = next(e for e in tx["entries"] if e["type"] == "salary")
    assert salary["details"].startswith(f"{_name(salary['month']['bs_month'])} salary · ")


async def test_single_payments_get_their_remark_and_clients_cannot_set_it(
    client, db, make_user, login
):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    month = TODAY.month
    advance = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": anita.id,
            "kind": "advance",
            "for_year": TODAY.year,
            "for_month": month,
            "amount": 500,
            "system_remark": "I wrote this",
        },
        headers=h,
    )
    assert advance.status_code == 201, advance.text
    assert advance.json()["payment"]["system_remark"] == f"Advance for {_name(month)}"

    one = await client.post(
        "/api/payroll/salary-payments",
        json={"employee_id": anita.id, "amount": 1000, "payment_mode_id": 1},
        headers=h,
    )
    assert one.status_code == 201, one.text
    oldest = one.json()["split"][0]["month"]["bs_month"]
    assert one.json()["payments"][0]["system_remark"] == f"Salary for {_name(oldest)}"

    pid = advance.json()["payment"]["id"]
    refused = await client.patch(
        f"/api/payroll/payments/{pid}/note",
        json={"note": "ok", "system_remark": "changed"},
        headers=h,
    )
    assert refused.status_code == 422
    stored = await db.scalar(select(Payment.system_remark).where(Payment.id == pid))
    assert stored == f"Advance for {_name(month)}"


async def test_note_add_edit_clear_for_the_group_with_audit(client, db, make_user, login):
    _, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    paid = await client.post(
        "/api/payroll/salary-payments",
        json={"employee_id": anita.id, "amount": 45000, "payment_mode_id": 1},
        headers=h,
    )
    group = paid.json()["payments"]
    remark = group[0]["system_remark"]
    last_id = group[-1]["id"]

    added = await client.patch(
        f"/api/payroll/payments/{last_id}/note", json={"note": "  Dashain bonus talk  "}, headers=h
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert body["note"] == "Dashain bonus talk" and body["note_updated_by"] == "Ram Admin"
    assert body["note_updated_at"] is not None and body["system_remark"] == remark
    notes = await db.scalars(select(Payment.note).where(Payment.employee_id == anita.id))
    assert set(notes) == {"Dashain bonus talk"}

    edited = await client.patch(
        f"/api/payroll/payments/{group[0]['id']}/note", json={"note": "Paid at home"}, headers=h
    )
    assert edited.json()["note"] == "Paid at home"
    cleared = await client.patch(
        f"/api/payroll/payments/{group[0]['id']}/note", json={"note": ""}, headers=h
    )
    assert cleared.status_code == 200 and cleared.json()["note"] is None
    stored = (
        await db.execute(
            select(Payment.note, Payment.system_remark).where(Payment.employee_id == anita.id)
        )
    ).all()
    assert set(stored) == {(None, remark)}

    audit = list(
        await db.scalars(
            select(AuditLog).where(AuditLog.action == "payment_note").order_by(AuditLog.id)
        )
    )
    assert [(a.data["before"]["note"], a.data["after"]["note"]) for a in audit] == [
        (None, "Dashain bonus talk"),
        ("Dashain bonus talk", "Paid at home"),
        ("Paid at home", None),
    ]
    assert all(a.user_id is not None for a in audit)

    tx = await _transactions(client, anita)
    row = next(e for e in tx["entries"] if e["payment"] is not None)
    assert row["payment"]["note"] is None and row["payment"]["system_remark"] == remark


async def test_note_needs_salary_advances(client, db, make_user, login):
    branch, anita = await _anita(db)
    h = await _admin(client, make_user, login)
    paid = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": anita.id,
            "kind": "advance",
            "for_year": TODAY.year,
            "for_month": TODAY.month,
            "amount": 500,
        },
        headers=h,
    )
    pid = paid.json()["payment"]["id"]
    await client.post("/api/auth/logout", headers=h)

    clerk = await make_user("clerk", role="manager")
    db.add(
        UserAccess(
            user_id=clerk.id,
            branch_id=branch.id,
            access={
                "mark_attendance": True,
                "view_attendance_report": True,
                "manage_employees": True,
                "salary_advances": False,
            },
        )
    )
    await db.flush()
    await login("clerk")
    h = {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}
    response = await client.patch(
        f"/api/payroll/payments/{pid}/note", json={"note": "sneaky"}, headers=h
    )
    assert response.status_code == 403
    assert await db.scalar(select(Payment.note).where(Payment.id == pid)) is None
