"""A past working day without an attendance record is unpaid ("not marked"), exactly like a day
marked absent - counted by the attendance summary, never stored as an A row, never for today,
a future day or a day before the joining date. Marking the day later takes the deduction away."""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.attendance import services as attendance
from app.modules.attendance.models import Record
from app.modules.payroll.models import PayType, SalaryHistory
from tests.attendance_days import attend

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)
PREVIOUS = bsdate.shift_month(*CURRENT, -1)
START, END = bsdate.bs_month_range(*PREVIOUS)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
WORKDAYS = [d for d in DAYS if not attendance.is_weekly_off(d)]
SATURDAYS = len(DAYS) - len(WORKDAYS)
#: Three working days of last month left without a record.
OPEN = [WORKDAYS[2], WORKDAYS[9], WORKDAYS[-1]]


async def _employee(db, joined=date(2026, 1, 1)):
    branch, dept = Branch(name="Main branch"), Department(name="Store")
    db.add_all([branch, dept])
    await db.flush()
    anita = Employee(
        full_name="Anita", branch_id=branch.id, department_id=dept.id, joined_ad=joined
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
    return anita


async def _owner(client, db, make_user, login, employee):
    """The super admin (may change past days), on the employee's branch."""
    user = await make_user("owner", role="admin")
    user.is_super_admin = True
    user.active_branch_id = employee.branch_id
    await db.flush()
    await login("owner")
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _ledger(client, employee, month=PREVIOUS):
    report = await client.get(f"/api/payroll/report/{month[0]:04d}-{month[1]:02d}")
    assert report.status_code == 200, report.text
    body = report.json()
    row = next(r for r in body["rows"] if r["employee"]["id"] == employee.id)
    return row["ledger"], body["totals"]


async def test_every_day_marked_is_paid_in_full(client, db, make_user, login):
    anita = await _employee(db)
    await attend(db, anita, PREVIOUS)
    await _owner(client, db, make_user, login, anita)
    ledger, totals = await _ledger(client, anita)
    a = ledger["attendance"]
    assert (a["not_marked"], a["absent"], a["present"]) == (0, 0, len(WORKDAYS))
    # Paid days are counted (present + overtime days + weekly off), not month − absent.
    assert ledger["paid_days"] == a["paid_days"] == len(WORKDAYS) + SATURDAYS == len(DAYS)
    assert (ledger["absence_deduction"], ledger["unpaid_days"], ledger["net"]) == (0, 0, 30000)
    assert (totals["not_marked_days"], totals["not_marked_staff"]) == (0, 0)


async def test_three_unmarked_past_days_are_deducted(client, db, make_user, login):
    anita = await _employee(db)
    await attend(db, anita, PREVIOUS, skip=OPEN)
    await _owner(client, db, make_user, login, anita)
    ledger, totals = await _ledger(client, anita)
    a = ledger["attendance"]
    assert (a["not_marked"], a["absent"], a["present"]) == (3, 0, len(WORKDAYS) - 3)
    assert ledger["paid_days"] == len(DAYS) - 3
    assert (ledger["absence_deduction"], ledger["unpaid_days"], ledger["net"]) == (3000, 3, 27000)
    assert (totals["not_marked_days"], totals["not_marked_staff"]) == (3, 1)
    assert totals["absent_days"] == 0 and totals["absence_deduction"] == 3000
    # The same figure everywhere payroll shows the month.
    balance = await client.get(
        "/api/payroll/balance",
        params={"employee_id": anita.id, "for_year": PREVIOUS[0], "for_month": PREVIOUS[1]},
    )
    assert balance.json()["earned"] == 27000
    month = await client.get(
        f"/api/payroll/employees/{anita.id}/ledger/{PREVIOUS[0]}-{PREVIOUS[1]:02d}"
    )
    assert month.json()["attendance"]["not_marked"] == 3 and month.json()["net"] == 27000
    entries = (await client.get(f"/api/payroll/employees/{anita.id}/transactions")).json()
    deduction = next(
        e
        for e in entries["entries"]
        if e["type"] == "absence" and (e["month"]["bs_year"], e["month"]["bs_month"]) == PREVIOUS
    )
    assert deduction["earned"] == -3000 and "3 not marked day(s) × Rs 1,000" in deduction["details"]
    # An absence is added to it, not counted twice.
    db.add(
        Record(
            employee_id=anita.id,
            date=OPEN[0],
            status="A",
            overtime_hours=0,
            branch_id=anita.branch_id,
            source="manual",
        )
    )
    await db.flush()
    ledger, _ = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["attendance"]["absent"]) == (2, 1)
    assert (ledger["unpaid_days"], ledger["net"]) == (3, 27000)


async def test_not_marked_is_computed_never_stored(client, db, make_user, login):
    anita = await _employee(db)
    await attend(db, anita, PREVIOUS, skip=OPEN)
    await _owner(client, db, make_user, login, anita)
    before = await db.scalar(select(func.count()).select_from(Record))
    for _ in range(2):
        ledger, _totals = await _ledger(client, anita)
        assert ledger["attendance"]["not_marked"] == 3
    assert await db.scalar(select(func.count()).select_from(Record)) == before
    assert (
        await db.scalar(select(func.count()).select_from(Record).where(Record.status == "A")) == 0
    )


async def test_days_before_joining_are_ignored(client, db, make_user, login):
    joined = WORKDAYS[12]
    anita = await _employee(db, joined=joined)
    mine = [d for d in WORKDAYS if d >= joined]
    await attend(db, anita, PREVIOUS)
    await _owner(client, db, make_user, login, anita)
    ledger, _ = await _ledger(client, anita)
    a = ledger["attendance"]
    # Nothing before the joining day counts as not marked (or as a weekly off).
    assert (a["not_marked"], a["present"]) == (0, len(mine))
    assert a["weekly_off"] == sum(1 for d in DAYS if d >= joined and attendance.is_weekly_off(d))
    assert ledger["paid_days"] == a["present"] + a["weekly_off"]
    assert ledger["absence_deduction"] == 0
    # ... and a working day after it without a record does.
    await db.execute(Record.__table__.delete().where(Record.date == mine[1]))
    ledger, _ = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["absence_deduction"]) == (1, 1000)


async def test_running_month_ignores_today_and_future_days(client, db, make_user, login):
    anita = await _employee(db)
    start, _end = bsdate.bs_month_range(*CURRENT)
    today = attendance.today()
    past = [
        start + timedelta(days=i)
        for i in range((today - start).days)
        if not attendance.is_weekly_off(start + timedelta(days=i))
    ]
    await _owner(client, db, make_user, login, anita)
    so_far = round(30000 * min(TODAY.day, 30) / 30)
    # Nothing marked at all: only the working days BEFORE today are not marked.
    ledger, _ = await _ledger(client, anita, CURRENT)
    assert ledger["in_progress"] is True
    assert ledger["attendance"]["not_marked"] == len(past)
    assert ledger["absence_deduction"] == min(1000 * len(past), so_far)
    # Every past day marked: today (no record yet) and the days to come cost nothing.
    await attend(db, anita, CURRENT)
    ledger, _ = await _ledger(client, anita, CURRENT)
    assert (ledger["attendance"]["not_marked"], ledger["absence_deduction"]) == (0, 0)
    assert ledger["net"] == so_far
    # A month that has not started has nothing to count.
    following = bsdate.shift_month(*CURRENT, 1)
    summary = await attendance_summary(anita, following)
    assert (summary.not_marked, summary.weekly_off, summary.paid_days) == (0, 0, 0)


async def attendance_summary(employee, month):
    from app.contracts import get_attendance_summary

    return await get_attendance_summary().for_month(employee.id, *month)


async def test_marking_the_day_later_removes_the_deduction(client, db, make_user, login):
    anita = await _employee(db)
    await attend(db, anita, PREVIOUS, skip=OPEN)
    h = await _owner(client, db, make_user, login, anita)
    ledger, _ = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["net"]) == (3, 27000)
    # The super admin marks one of the open days Present (a past day: reason required).
    marked = await client.post(
        "/api/attendance/mark",
        json={
            "date_bs": bsdate.ad_to_bs(OPEN[1]).isoformat(),
            "employee_id": anita.id,
            "status": "P",
            "ot_hours": 0,
            "reason": "Was at work, the day was never marked",
        },
        headers=h,
    )
    assert marked.status_code == 200, marked.text
    ledger, totals = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["absence_deduction"]) == (2, 2000)
    assert ledger["net"] == 28000 and totals["not_marked_days"] == 2
    # All of them marked: the month is paid in full again.
    await attend(db, anita, PREVIOUS)
    ledger, totals = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["net"]) == (0, 30000)
    assert totals["not_marked_staff"] == 0


async def test_pay_slip_and_the_paid_months_check(client, db, make_user, login):
    from app.modules.payroll.audit import unmarked_paid_months

    anita = await _employee(db)
    await attend(db, anita, PREVIOUS, skip=OPEN)
    h = await _owner(client, db, make_user, login, anita)
    assert await unmarked_paid_months(db) == []  # nothing paid yet
    paid = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": anita.id,
            "kind": "salary",
            "for_year": PREVIOUS[0],
            "for_month": PREVIOUS[1],
            "amount": 27000,
            "payment_mode_id": 1,
        },
        headers=h,
    )
    assert paid.status_code == 201, paid.text
    # The check lists the month: worth 30,000 under the old rule, 27,000 now, nothing overpaid.
    [row] = await unmarked_paid_months(db)
    assert (row.employee_id, (row.year, row.month)) == (anita.id, PREVIOUS)
    assert (row.not_marked, row.old_net, row.net, row.paid, row.overpaid) == (
        3,
        30000,
        27000,
        27000,
        0,
    )
    # The pay slip prints with the Not marked row and the split deduction line.
    slip = await client.get(
        f"/api/payroll/employees/{anita.id}/payslips/{PREVIOUS[0]}-{PREVIOUS[1]:02d}.pdf"
    )
    if slip.status_code == 503:
        pytest.skip("WeasyPrint native libraries missing (brew install pango)")
    assert slip.status_code == 200 and slip.content[:5] == b"%PDF-"
    # Once the days are marked the month drops off the list.
    await attend(db, anita, PREVIOUS)
    assert await unmarked_paid_months(db) == []
