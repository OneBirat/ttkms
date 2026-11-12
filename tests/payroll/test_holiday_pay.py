"""Public holidays and pay: a paid holiday without an attendance row is not an absence and
costs nothing; an unpaid one costs the day without being "not marked"; another branch's holiday
does not count; working on a holiday pays the overtime hours marked, at the usual rate."""

from datetime import date, timedelta

import pytest

from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.attendance import services as attendance
from app.modules.attendance.models import Holiday, HolidayBranch, Record
from app.modules.payroll.models import PayType, SalaryHistory
from tests.attendance_days import attend

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
PREVIOUS = bsdate.shift_month(TODAY.year, TODAY.month, -1)
START, END = bsdate.bs_month_range(*PREVIOUS)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
WORKDAYS = [d for d in DAYS if not attendance.is_weekly_off(d)]
HOLIDAY = WORKDAYS[6]


async def _setup(db, client, make_user, login, pay_type=PayType.monthly, amount=30000):
    main, other = Branch(name="Main branch"), Branch(name="Branch 2")
    dept = Department(name="Store")
    db.add_all([main, other, dept])
    await db.flush()
    anita = Employee(
        full_name="Anita", branch_id=main.id, department_id=dept.id, joined_ad=date(2026, 1, 1)
    )
    db.add(anita)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=anita.id,
            pay_type=pay_type,
            basic=amount,
            ot_rate=125,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    # Present on every working day of last month except the holiday.
    await attend(db, anita, PREVIOUS, skip=[HOLIDAY])
    user = await make_user("admin", role="admin")
    user.active_branch_id = main.id
    await db.flush()
    await login("admin")
    return anita, main, other


async def _holiday(db, name="Dashain", branches=(), is_paid=True):
    holiday = Holiday(
        date=HOLIDAY,
        name=name,
        all_branches=not branches,
        is_paid=is_paid,
        branches=[HolidayBranch(branch_id=b.id) for b in branches],
    )
    db.add(holiday)
    await db.flush()
    return holiday


async def _ledger(client, employee):
    report = await client.get(f"/api/payroll/report/{PREVIOUS[0]:04d}-{PREVIOUS[1]:02d}")
    assert report.status_code == 200, report.text
    return next(r for r in report.json()["rows"] if r["employee"]["id"] == employee.id)["ledger"]


async def test_a_paid_holiday_without_a_mark_costs_nothing(client, db, make_user, login):
    anita, _main, _other = await _setup(db, client, make_user, login)
    # Without the holiday the open day is not marked: one day is cut.
    before = await _ledger(client, anita)
    assert (before["attendance"]["not_marked"], before["absence_deduction"]) == (1, 1000)
    await _holiday(db)
    ledger = await _ledger(client, anita)
    a = ledger["attendance"]
    assert (a["not_marked"], a["absent"], a["holidays"], a["unpaid_holidays"]) == (0, 0, 1, 0)
    assert (ledger["absence_deduction"], ledger["unpaid_days"], ledger["net"]) == (0, 0, 30000)
    # It is a paid day, like a Saturday.
    assert ledger["paid_days"] == a["paid_days"] == len(DAYS)
    # Nothing was written to the attendance records for it.
    assert await db.get(Record, (await _record_id(db, anita))) is None


async def _record_id(db, employee):
    from sqlalchemy import select

    return (
        await db.scalar(
            select(Record.id).where(Record.employee_id == employee.id, Record.date == HOLIDAY)
        )
        or 0
    )


async def test_an_absent_mark_on_a_paid_holiday_is_no_absence(client, db, make_user, login):
    anita, _main, _other = await _setup(db, client, make_user, login)
    await _holiday(db)
    db.add(
        Record(
            employee_id=anita.id,
            date=HOLIDAY,
            status="A",
            overtime_hours=0,
            branch_id=anita.branch_id,
            source="manual",
        )
    )
    await db.flush()
    ledger = await _ledger(client, anita)
    assert (ledger["attendance"]["absent"], ledger["attendance"]["holidays"]) == (0, 1)
    assert ledger["net"] == 30000


async def test_an_unpaid_holiday_cuts_the_day_without_being_not_marked(
    client, db, make_user, login
):
    anita, _main, _other = await _setup(db, client, make_user, login)
    await _holiday(db, is_paid=False)
    ledger = await _ledger(client, anita)
    a = ledger["attendance"]
    assert (a["not_marked"], a["absent"], a["holidays"], a["unpaid_holidays"]) == (0, 0, 0, 1)
    assert (ledger["absence_deduction"], ledger["unpaid_days"], ledger["net"]) == (1000, 1, 29000)


async def test_another_branchs_holiday_does_not_count(client, db, make_user, login):
    anita, main, other = await _setup(db, client, make_user, login)
    await _holiday(db, branches=[other])
    ledger = await _ledger(client, anita)
    assert (ledger["attendance"]["not_marked"], ledger["attendance"]["holidays"]) == (1, 0)
    assert ledger["net"] == 29000
    # Her own branch's holiday does.
    await db.execute(Holiday.__table__.delete())
    await _holiday(db, branches=[main])
    assert (await _ledger(client, anita))["net"] == 30000


async def test_work_on_a_holiday_pays_the_overtime_hours_marked(client, db, make_user, login):
    anita, _main, _other = await _setup(db, client, make_user, login)
    await _holiday(db)
    record = Record(
        employee_id=anita.id,
        date=HOLIDAY,
        status="P",
        overtime_hours=0,
        branch_id=anita.branch_id,
        source="manual",
    )
    db.add(record)
    await db.flush()
    # Present alone adds nothing to a monthly salary ...
    ledger = await _ledger(client, anita)
    assert (ledger["net"], ledger["overtime_pay"], ledger["attendance"]["holidays"]) == (
        30000,
        0,
        0,
    )
    assert ledger["paid_days"] == len(DAYS)
    # ... the hours entered are paid at the employee's overtime rate (Rs 125): no holiday rate.
    record.status, record.overtime_hours = "O", 3
    await db.flush()
    ledger = await _ledger(client, anita)
    assert (ledger["overtime_pay"], ledger["net"]) == (375, 30375)


async def test_daily_wage_staff_are_paid_for_days_worked_only(client, db, make_user, login):
    anita, _main, _other = await _setup(db, client, make_user, login, PayType.daily, 800)
    worked = len(WORKDAYS) - 1
    assert (await _ledger(client, anita))["net"] == 800 * worked
    await _holiday(db)
    ledger = await _ledger(client, anita)
    assert ledger["net"] == 800 * worked and ledger["absence_deduction"] == 0
