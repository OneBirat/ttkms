"""GET /api/payroll/payslips: every amount equals the Salary report row, absent dates, the
deduction per reason, branch scoping and permission."""

from datetime import date, timedelta

import pytest

from app.contracts import MonthSummary
from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import effective_access
from app.modules.attendance import services as attendance
from app.modules.attendance.models import Record
from app.modules.payroll import rules
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource, PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
#: The month before the running one: closed, so nothing is "so far".
LAST = bsdate.shift_month(TODAY.year, TODAY.month, -1)
LAST_KEY = f"{LAST[0]}-{LAST[1]:02d}"
THIS_KEY = f"{TODAY.year}-{TODAY.month:02d}"


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


def _working_days(year: int, month: int) -> list[date]:
    start, end = bsdate.bs_month_range(year, month)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return [d for d in days if not attendance.is_weekly_off(d)]


async def _employee(db, name, branch, dept, pay, amount, ot_rate, designation=None) -> Employee:
    e = Employee(
        full_name=name,
        branch_id=branch.id,
        department_id=dept.id,
        designation=designation,
        joined_ad=date(2026, 1, 1),
    )
    db.add(e)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=e.id,
            pay_type=PayType(pay),
            basic=amount,
            ot_rate=ot_rate,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()
    return e


def _mark(db, e: Employee, day: date, status: str, hours: int = 0) -> None:
    db.add(
        Record(
            employee_id=e.id,
            date=day,
            status=status,
            overtime_hours=hours,
            branch_id=e.branch_id,
            source="manual",
        )
    )


def _pay(db, e: Employee, receipt: str, kind: str, amount: int, day: date, month=LAST) -> None:
    db.add(
        Payment(
            receipt_no=receipt,
            employee_id=e.id,
            branch_id=e.branch_id,
            kind=PaymentKind(kind),
            for_year=month[0],
            for_month=month[1],
            amount=amount,
            payment_mode_id=1,
            date=day,
            source=PaymentSource.account,
        )
    )


async def _setup(db, attended):
    """Main branch: Anita (monthly; last month one Absent day, one unmarked day, 3 h overtime,
    two advances and a salary payment), Bikash (monthly; a full month, nothing paid), Ramesh
    (daily wage; one Absent day, one advance). Branch 2: Mina."""
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store, kitchen = Department(name="Store"), Department(name="Kitchen")
    db.add_all([main, second, store, kitchen])
    await db.flush()
    anita = await _employee(db, "Anita", main, store, "monthly", 30000, 125, "Store keeper")
    bikash = await _employee(db, "Bikash", main, kitchen, "monthly", 24000, 100)
    ramesh = await _employee(db, "Ramesh", main, store, "daily", 650, 81, "Helper")
    mina = await _employee(db, "Mina", second, kitchen, "monthly", 24000, 100)
    work = _working_days(*LAST)
    absent, unmarked, overtime = work[1], work[2], work[3]
    _mark(db, anita, absent, "A")
    _mark(db, anita, overtime, "O", 3)
    _mark(db, ramesh, absent, "A")
    await db.flush()
    await attended(anita, LAST, skip=[unmarked])
    for e in (bikash, ramesh, mina):
        await attended(e, LAST)
    _pay(db, anita, "ADV-0001", "advance", 4000, work[4])
    _pay(db, anita, "ADV-0002", "advance", 1500, work[6])
    _pay(db, anita, "SAL-0001", "salary", 10000, work[-1])
    _pay(db, ramesh, "ADV-0003", "advance", 500, work[5])
    await db.flush()
    return {
        "main": main,
        "second": second,
        "anita": anita,
        "bikash": bikash,
        "ramesh": ramesh,
        "mina": mina,
        "absent": absent,
        "unmarked": unmarked,
        "work": work,
    }


def _url(branch: Branch, employees, key: str = LAST_KEY) -> str:
    ids = ",".join(str(e.id) for e in employees)
    return f"/api/payroll/payslips?branch_id={branch.id}&month={key}&employee_ids={ids}"


def _same_as_report(slip: dict, ledger: dict) -> None:
    assert slip["base_amount"] == ledger["gross_salary"]
    assert slip["absence_deduction"] == ledger["absence_deduction"]
    assert slip["overtime_amount"] == ledger["overtime_pay"]
    assert slip["overtime_rate"] == ledger["ot_rate"]
    assert slip["earned"] == ledger["net"]
    assert slip["advances_total"] == ledger["paid"]
    assert slip["balance_due"] == ledger["due"]
    assert slip["paid_days"] == ledger["paid_days"]
    assert slip["absent_days"] == ledger["attendance"]["absent"]
    assert slip["unmarked_days"] == ledger["attendance"]["not_marked"]
    assert slip["month"]["days_in_month"] == ledger["attendance"]["days_in_month"]
    assert slip["employee"]["rate"] == ledger["rate"]
    # The slip adds up on its own lines.
    assert (
        slip["base_amount"] - slip["absence_deduction"] + slip["overtime_amount"]
        == (slip["earned"])
    )
    assert sum(d["amount"] for d in slip["deductions"]) == slip["absence_deduction"]
    assert sum(p["amount"] for p in slip["advances"]) == slip["advances_total"]


async def test_slips_equal_the_report_rows(client, db, make_user, login, attended):
    s = await _setup(db, attended)
    await make_user("admin", role="admin")
    await login("admin")
    # Asked for in this order: Ramesh, Anita, Bikash.
    response = await client.get(_url(s["main"], [s["ramesh"], s["anita"], s["bikash"]]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["business"] == "TTK" and body["branch"]["name"] == "Main branch"
    assert body["month"] == {"bs_year": LAST[0], "bs_month": LAST[1]}
    assert body["today"]["bs"] == TODAY.isoformat()
    slips = body["slips"]
    assert [x["employee"]["name"] for x in slips] == ["Ramesh", "Anita", "Bikash"]
    report = (await client.get(f"/api/payroll/report/{LAST_KEY}")).json()
    rows = {r["employee"]["full_name"]: r["ledger"] for r in report["rows"]}
    for slip in slips:
        _same_as_report(slip, rows[slip["employee"]["name"]])
        assert slip["in_progress"] is False
        assert slip["slip_printed_at"] is None and slip["slip_printed_by"] is None

    ramesh, anita, bikash = slips
    absent_bs = bsdate.ad_to_bs(s["absent"]).isoformat()
    # Monthly, one Absent day + one unmarked day, 3 h overtime, three payments.
    assert anita["employee"] == {
        "id": s["anita"].id,
        "code": s["anita"].code,
        "name": "Anita",
        "role": "Store keeper",
        "department": "Store",
        "pay_type": "monthly",
        "rate": 30000,
    }
    assert anita["month"]["name"] == bsdate.bs_month_name(LAST[1])
    assert anita["base_amount"] == 30000 and anita["day_rate"] == 1000
    assert anita["absent_days"] == 1 and anita["absent_dates"] == [absent_bs]
    assert anita["unmarked_days"] == 1
    assert anita["deductions"] == [
        {"reason": "absent", "days": 1, "amount": 1000},
        {"reason": "not_marked", "days": 1, "amount": 1000},
    ]
    assert anita["absence_deduction"] == 2000
    assert anita["overtime_hours"] == 3 and anita["overtime_amount"] == 375
    assert anita["earned"] == 30000 - 2000 + 375
    assert [(p["kind"], p["mode"], p["amount"]) for p in anita["advances"]] == [
        ("advance", "Cash", 4000),
        ("advance", "Cash", 1500),
        ("salary", "Cash", 10000),
    ]
    assert anita["advances"][0]["date"]["bs"] == bsdate.ad_to_bs(s["work"][4]).isoformat()
    assert anita["advances_total"] == 15500 and anita["balance_due"] == 28375 - 15500

    # Monthly, a full month: no absence, no overtime, nothing paid.
    assert bikash["absent_days"] == 0 and bikash["absent_dates"] == []
    assert bikash["deductions"] == [] and bikash["absence_deduction"] == 0
    assert bikash["overtime_hours"] == 0 and bikash["overtime_amount"] == 0
    assert bikash["advances"] == [] and bikash["advances_total"] == 0
    assert bikash["earned"] == 24000 == bikash["balance_due"]
    assert bikash["employee"]["role"] is None

    # Daily wage: days x wage, nothing deducted for the Absent day (it is simply not paid).
    assert ramesh["employee"]["pay_type"] == "daily" and ramesh["employee"]["rate"] == 650
    assert ramesh["base_amount"] == 650 * ramesh["paid_days"] and ramesh["day_rate"] == 650
    assert ramesh["absent_days"] == 1 and ramesh["absent_dates"] == [absent_bs]
    assert ramesh["deductions"] == [] and ramesh["absence_deduction"] == 0
    assert ramesh["advances_total"] == 500
    assert ramesh["balance_due"] == ramesh["earned"] - 500


async def test_running_month_slip_is_so_far(client, db, make_user, login, attended):
    s = await _setup(db, attended)
    await attended(s["anita"], (TODAY.year, TODAY.month))
    await make_user("admin", role="admin")
    await login("admin")
    slip = (await client.get(_url(s["main"], [s["anita"]], THIS_KEY))).json()["slips"][0]
    row = (await client.get(f"/api/payroll/report/{THIS_KEY}")).json()["rows"][0]["ledger"]
    _same_as_report(slip, row)
    assert slip["in_progress"] is True and slip["days_counted"] == TODAY.day
    assert slip["base_amount"] == rules.round_rs(30000 * min(TODAY.day, 30) / 30)


async def test_absent_dates_ascending_and_only_absences(client, db, make_user, login, attended):
    s = await _setup(db, attended)
    work = s["work"]
    # Three of Bikash's Present days become Absent (given out of order).
    await db.execute(
        Record.__table__.update()
        .where(Record.employee_id == s["bikash"].id, Record.date.in_([work[9], work[0], work[5]]))
        .values(status="A")
    )
    await db.flush()
    await make_user("admin", role="admin")
    await login("admin")
    slip = (await client.get(_url(s["main"], [s["bikash"]]))).json()["slips"][0]
    assert slip["absent_dates"] == [
        bsdate.ad_to_bs(d).isoformat() for d in (work[0], work[5], work[9])
    ]
    assert slip["absent_days"] == 3 and slip["unmarked_days"] == 0
    assert slip["deductions"] == [{"reason": "absent", "days": 3, "amount": 2400}]
    assert slip["earned"] == 24000 - 2400


async def test_branch_scoping_and_bad_requests(client, db, make_user, login, attended):
    s = await _setup(db, attended)
    main, second = s["main"], s["second"]
    await make_user("admin", role="admin")
    await login("admin")
    # see_other_branches: another branch is fine, but only with that branch's own people.
    other = await client.get(_url(second, [s["mina"]]))
    assert other.status_code == 200 and other.json()["branch"]["name"] == "Branch 2"
    mixed = await client.get(_url(main, [s["anita"], s["mina"]]))
    assert mixed.status_code == 403 and "Mina" in mixed.json()["detail"]
    assert (await client.get(_url(main, [s["anita"]]) + ",99999")).status_code == 404
    assert (await client.get(_url(main, []))).status_code == 422
    bad_ids = f"/api/payroll/payslips?branch_id={main.id}&month={LAST_KEY}&employee_ids=1,x"
    assert (await client.get(bad_ids)).status_code == 422
    assert (await client.get(_url(main, [s["anita"]], "2083-13"))).status_code == 422
    assert (await client.get(_url(main, [s["anita"]], "2099-01"))).status_code == 404
    unknown_branch = f"/api/payroll/payslips?branch_id=999&month={LAST_KEY}&employee_ids=1"
    assert (await client.get(unknown_branch)).status_code == 404
    # Repeats are printed once.
    twice = await client.get(_url(main, [s["anita"], s["anita"]]))
    assert len(twice.json()["slips"]) == 1
    # Someone who is in the branch but not on that month's sheet (joined later) is refused.
    late = await _employee(db, "Late", main, s["anita"].department, "monthly", 9000, 40)
    late.joined_ad = bsdate.today_ad()
    await db.flush()
    not_on_sheet = await client.get(_url(main, [s["anita"], late]))
    assert not_on_sheet.status_code == 422 and "Late" in not_on_sheet.json()["detail"]

    # Without see_other_branches: the own branch only - another branch is a 403, never a
    # silent switch.
    await client.post("/api/auth/logout", headers={"X-CSRF-Token": await _csrf(client)})
    cashier = await make_user("cashier", role="manager")
    db.add(
        UserAccess(
            user_id=cashier.id,
            branch_id=second.id,
            access=effective_access("manager", {"salary_advances": True}),
        )
    )
    await db.flush()
    await login("cashier")
    own = await client.get(_url(second, [s["mina"]]))
    assert own.status_code == 200 and own.json()["slips"][0]["employee"]["name"] == "Mina"
    assert (await client.get(_url(main, [s["anita"]]))).status_code == 403
    assert (await client.get(_url(second, [s["anita"]]))).status_code == 403


async def test_needs_the_salary_report_permission(client, db, make_user, login, attended):
    s = await _setup(db, attended)
    url = _url(s["main"], [s["anita"]])
    assert (await client.get(url)).status_code == 401
    boss = await make_user("boss", role="manager")
    db.add(UserAccess(user_id=boss.id, branch_id=s["main"].id, access=None))
    await db.flush()
    await login("boss")
    assert (await client.get(url)).status_code == 403


def _summary(**days: int) -> MonthSummary:
    base = dict(
        days_in_month=30,
        present=20,
        overtime_days=0,
        overtime_hours=0,
        absent=0,
        weekly_off=4,
        paid_days=24,
        days_counted=30,
    )
    return MonthSummary(**{**base, **days})


def test_deduction_split_adds_up():
    assert rules.split_deduction(2000, [1, 1]) == [1000, 1000]
    # 26,000 / 30 x 4 = 3,467: 1 absent + 3 not marked.
    assert rules.split_deduction(3467, [1, 3]) == [867, 2600]
    assert rules.split_deduction(100, [1, 1, 1]) == [33, 33, 34]
    assert rules.split_deduction(0, [2, 1]) == [0, 0]
    assert rules.split_deduction(500, []) == []
    assert rules.split_deduction(500, [0, 3, 0]) == [0, 500, 0]
    # Capped at the salary (monthly_pay): the parts still add up.
    for total, days in ((14000, [20, 15]), (1, [1, 1, 1, 1]), (99999, [7, 0, 2, 1])):
        assert sum(rules.split_deduction(total, days)) == total


def test_unpaid_reasons_are_the_days_monthly_pay_cuts():
    s = _summary(absent=2, not_marked=3, days_after_leaving=4, unpaid_holidays=1)
    reasons = rules.unpaid_reasons(s)
    assert reasons == [
        ("absent", 2),
        ("not_marked", 3),
        ("after_leaving", 4),
        ("unpaid_holiday", 1),
    ]
    pay = rules.monthly_pay(30000, 125, s)
    assert sum(days for _, days in reasons) == pay.unpaid_days == 10
    assert sum(rules.split_deduction(pay.absence_deduction, [d for _, d in reasons])) == 10000
    assert rules.unpaid_reasons(_summary()) == []
    assert rules.unpaid_reasons(_summary(not_marked=2)) == [("not_marked", 2)]


def test_day_rate():
    assert rules.day_rate("monthly", 26000) == 866.67
    assert rules.day_rate("monthly", 30000) == 1000
    assert rules.day_rate("daily", 650) == 650
