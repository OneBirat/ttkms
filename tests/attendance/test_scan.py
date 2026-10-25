"""Scan flow: payroll's by-barcode lookup (TTK-E001, legacy TTK-E-001), the "already marked"
state, marking today with source scan, and the payment step through the real PayrollPayments
contract (Cash by default; the month of the date unless for_* is sent)."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from app import contracts
from app.core import bsdate
from app.modules.attendance import services
from app.modules.attendance.models import Record
from app.modules.payroll.models import Payment, PayType, SalaryHistory

pytestmark = pytest.mark.anyio


async def _as(client, login, user_in, name="boss", role="manager", branch=None):
    await user_in(name, role, branch)
    await login(name)
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def test_barcode_then_lookup_then_scan(client, db, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    anita = world.people["Anita"]
    legacy = "TTK-" + anita.code  # "TTK-E-001", stickers printed before 2026-10-26
    for code in (anita.barcode, legacy):
        found = await client.get(f"/api/payroll/employees/by-barcode/{code}")
        assert found.status_code == 200, found.text
        assert found.json()["id"] == anita.id
    before = await client.get("/api/attendance/lookup", params={"employee_id": anita.id})
    assert before.status_code == 200
    body = before.json()
    assert body["today"] is None and body["code"] == anita.barcode
    assert body["date"] == bsdate.today_ad().isoformat()
    assert body["date_bs"] == bsdate.today_bs().isoformat()
    scanned = await client.post(
        "/api/attendance/scan",
        json={"employee_id": anita.id, "action": "overtime", "ot_hours": 2},
        headers=h,
    )
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["record"]["marked_via"] == "scan"
    assert scanned.json()["previous"] == "N"
    after = await client.get("/api/attendance/lookup", params={"employee_id": anita.id})
    assert after.json()["today"]["status"] == "O" and after.json()["today"]["ot_hours"] == 2
    present = await client.post(
        "/api/attendance/scan", json={"employee_id": anita.id, "action": "present"}, headers=h
    )
    assert present.json()["previous"] == "O" and present.json()["record"]["ot_hours"] == 0
    record = await db.scalar(select(Record).where(Record.employee_id == anita.id))
    assert (record.date, record.status, record.source) == (bsdate.today_ad(), "P", "scan")


async def test_scan_rules(client, login, user_in, world):
    h = await _as(client, login, user_in, branch=world.main)
    bad = await client.post(
        "/api/attendance/scan",
        json={"employee_id": world.people["Anita"].id, "action": "overtime", "ot_hours": 0},
        headers=h,
    )
    assert bad.status_code == 422
    inactive = await client.get(
        "/api/attendance/lookup", params={"employee_id": world.people["Old Hari"].id}
    )
    assert inactive.status_code == 404
    other = await client.post(
        "/api/attendance/scan",
        json={"employee_id": world.people["Mina"].id, "action": "present"},
        headers=h,
    )
    assert other.status_code == 403


async def test_scan_marks_the_kathmandu_day(client, login, user_in, world, monkeypatch):
    h = await _as(client, login, user_in, branch=world.main)
    monkeypatch.setattr(services, "now", lambda: datetime(2026, 10, 20, 18, 16, tzinfo=UTC))
    scanned = await client.post(
        "/api/attendance/scan",
        json={"employee_id": world.people["Anita"].id, "action": "present"},
        headers=h,
    )
    assert scanned.json()["date"] == "2026-10-21"


async def _salary(db, employee, amount=30000):
    db.add(
        SalaryHistory(
            employee_id=employee.id,
            pay_type=PayType.monthly,
            basic=amount,
            ot_rate=125,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()


async def test_scan_payment_goes_through_the_payroll_contract(db, world):
    """The scan flow's advance: no for_* -> the BS month of the date; Cash unless told."""
    anita = world.people["Anita"]
    await _salary(db, anita)
    payroll = contracts.get_payroll_payments()
    assert not isinstance(payroll, contracts.FakePayrollPayments)
    result = await payroll.record(
        contracts.PaymentInput(employee_id=anita.id, kind="advance", amount=500, source="scan")
    )
    today = bsdate.today_bs()
    assert (result.payment.for_year, result.payment.for_month) == (today.year, today.month)
    assert result.payment.payment_mode_id == contracts.CASH_PAYMENT_MODE_ID
    previous = bsdate.shift_month(today.year, today.month, -1)
    salary = await payroll.record(
        contracts.PaymentInput(
            employee_id=anita.id,
            kind="salary",
            amount=1000,
            for_year=previous[0],
            for_month=previous[1],
            source="scan",
        )
    )
    assert (salary.payment.for_year, salary.payment.for_month) == previous
    assert salary.payment.date == bsdate.today_ad()
    rows = list(await db.scalars(select(Payment).where(Payment.employee_id == anita.id)))
    assert sorted((p.kind.value, p.for_month, p.source.value) for p in rows) == sorted(
        [("advance", today.month, "scan"), ("salary", previous[1], "scan")]
    )


async def test_scan_advance_over_http_needs_no_for_month(client, db, login, user_in, world):
    """The scan sheet posts an advance without for_*: payroll counts it for the BS month of the
    payment date (today). Salary goes with the explicit settlement month; for_* come in pairs."""
    anita = world.people["Anita"]
    await _salary(db, anita)
    h = await _as(client, login, user_in, "chief", "admin")
    today = bsdate.today_bs()
    advance = await client.post(
        "/api/payroll/payments",
        json={"employee_id": anita.id, "kind": "advance", "amount": 200, "source": "scan"},
        headers=h,
    )
    assert advance.status_code == 201, advance.text
    body = advance.json()["payment"]
    assert (body["for_year"], body["for_month"]) == (today.year, today.month)
    assert body["payment_mode"]["id"] == 1 and body["source"] == "scan"
    half = await client.post(
        "/api/payroll/payments",
        json={"employee_id": anita.id, "kind": "advance", "amount": 200, "for_year": today.year},
        headers=h,
    )
    assert half.status_code == 422
    summary = (await client.get(f"/api/payroll/employees/{anita.id}/summary")).json()
    salary_month = (summary["salary_month"]["bs_year"], summary["salary_month"]["bs_month"])
    assert salary_month == bsdate.shift_month(today.year, today.month, -1)  # last month still due
    salary = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": anita.id,
            "kind": "salary",
            "amount": 1000,
            "for_year": salary_month[0],
            "for_month": salary_month[1],
            "source": "scan",
        },
        headers=h,
    )
    assert salary.status_code == 201, salary.text
    assert salary.json()["payment"]["for_month"] == salary_month[1]
