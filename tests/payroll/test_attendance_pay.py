"""Attendance -> payroll end to end: an absence lowers monthly pay by salary / 30, the running
month is "so far" (prorated, which caps advances), Saturday work under both values of
payroll.saturday_work_rule, and the admin-only setting itself."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core import bsdate
from app.core.models import AuditLog, Branch, Department, Employee
from app.modules.attendance.models import Record
from app.modules.payroll.models import PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)
PREVIOUS = bsdate.shift_month(*CURRENT, -1)
START, END = bsdate.bs_month_range(*PREVIOUS)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
SATURDAY = next(d for d in DAYS if bsdate.weekday_index(d) == 6)
WORKDAY = next(d for d in DAYS if bsdate.weekday_index(d) == 2)


async def _anita(db, pay_type=PayType.monthly, amount=30000, ot_rate=125):
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
            pay_type=pay_type,
            basic=amount,
            ot_rate=ot_rate,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()
    return anita


def _rec(employee, day, status="P", hours=0):
    return Record(
        employee_id=employee.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=employee.branch_id,
        source="manual",
    )


async def _admin(client, make_user, login):
    await make_user("admin", role="admin")
    await login("admin")
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _earned(client, employee, month):
    response = await client.get(
        "/api/payroll/balance",
        params={"employee_id": employee.id, "for_year": month[0], "for_month": month[1]},
    )
    assert response.status_code == 200, response.text
    return response.json()["earned"]


async def _report_net(client, employee, month):
    report = await client.get(f"/api/payroll/report/{month[0]:04d}-{month[1]:02d}")
    assert report.status_code == 200, report.text
    row = next(r for r in report.json()["rows"] if r["employee"]["id"] == employee.id)
    return row["ledger"]


async def test_marking_absent_lowers_the_month_by_salary_over_30(client, db, make_user, login):
    anita = await _anita(db)
    h = await _admin(client, make_user, login)
    assert await _earned(client, anita, PREVIOUS) == 30000
    marked = await client.post(
        "/api/attendance/mark",
        json={
            "date_bs": bsdate.ad_to_bs(WORKDAY).isoformat(),
            "employee_id": anita.id,
            "status": "A",
        },
        headers=h,
    )
    assert marked.status_code == 200
    assert await _earned(client, anita, PREVIOUS) == 29000
    ledger = await _report_net(client, anita, PREVIOUS)
    assert ledger["absence_deduction"] == 1000 and ledger["net"] == 29000
    assert ledger["attendance"]["absent"] == 1 and ledger["attendance"]["days_counted"] == len(DAYS)


async def test_running_month_is_earned_so_far(client, db, make_user, login):
    anita = await _anita(db)
    await _admin(client, make_user, login)
    expected = round(30000 * min(TODAY.day, 30) / 30)
    assert await _earned(client, anita, CURRENT) == expected
    ledger = await _report_net(client, anita, CURRENT)
    assert ledger["in_progress"] is True and ledger["attendance"]["days_counted"] == TODAY.day
    summary = (await client.get(f"/api/payroll/employees/{anita.id}/summary")).json()
    assert summary["earned_so_far"] == expected and summary["room"] == expected


@pytest.mark.parametrize(("rule", "extra"), [("overtime_only", 0), ("extra_day", 1000)])
async def test_saturday_work_rule(client, db, make_user, login, rule, extra):
    anita = await _anita(db)
    h = await _admin(client, make_user, login)
    db.add(_rec(anita, SATURDAY, "O", 4))
    await db.flush()
    saved = await client.put(
        "/api/admin/settings/payroll", json={"saturday_work_rule": rule}, headers=h
    )
    assert saved.status_code == 200 and saved.json()["saturday_work_rule"] == rule
    ledger = await _report_net(client, anita, PREVIOUS)
    assert ledger["attendance"]["saturday_days_worked"] == 1
    assert ledger["attendance"]["saturday_ot_hours"] == 4
    assert ledger["overtime_pay"] == 4 * 125 and ledger["saturday_pay"] == extra
    assert ledger["net"] == 30000 + 500 + extra


async def test_daily_staff_paid_for_saturday_whatever_the_rule(client, db, make_user, login):
    anita = await _anita(db, PayType.daily, 800, 100)
    h = await _admin(client, make_user, login)
    db.add_all([_rec(anita, WORKDAY), _rec(anita, SATURDAY, "O", 2)])
    await db.flush()
    for rule in ("overtime_only", "extra_day"):
        await client.put(
            "/api/admin/settings/payroll", json={"saturday_work_rule": rule}, headers=h
        )
        assert await _earned(client, anita, PREVIOUS) == 2 * 800 + 200


async def test_the_setting_is_admin_only_and_audited(client, db, make_user, login):
    h = await _admin(client, make_user, login)
    got = await client.get("/api/admin/settings/payroll")
    assert got.json() == {"saturday_work_rule": "overtime_only", "pending_decision": True}
    bad = await client.put(
        "/api/admin/settings/payroll", json={"saturday_work_rule": "x"}, headers=h
    )
    assert bad.status_code == 422
    await client.put(
        "/api/admin/settings/payroll", json={"saturday_work_rule": "extra_day"}, headers=h
    )
    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "settings.update"))
    assert audit.data == {"before": "overtime_only", "after": "extra_day"}
    await client.post("/api/auth/logout", headers=h)
    await make_user("boss", role="manager")
    await login("boss")
    assert (await client.get("/api/admin/settings/payroll")).status_code == 403
