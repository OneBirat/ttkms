"""Attendance overrides and pay. Salary and dues are recalculated from attendance every time, so
a super-admin change to a past day moves that month's net pay and due by itself; before saving,
the override preview warns when the month is already paid (fully or partly) - and never blocks."""

from datetime import date, timedelta

import pytest

from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.attendance.models import Record
from app.modules.payroll.models import PayType, SalaryHistory
from tests.attendance_days import attend

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)
PREVIOUS = bsdate.shift_month(*CURRENT, -1)
START, END = bsdate.bs_month_range(*PREVIOUS)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
WORKDAY = next(d for d in DAYS if bsdate.weekday_index(d) == 2)
OTHER_DAY = next(d for d in DAYS if bsdate.weekday_index(d) == 3)
LABEL = f"{bsdate.bs_month_name(PREVIOUS[1])} {PREVIOUS[0]}"
REASON = "Was absent, marked present by mistake"


def bs(day: date) -> str:
    return bsdate.ad_to_bs(day).isoformat()


async def _employee(db, name="Anita", pay_type=PayType.monthly, amount=30000, ot_rate=125):
    branch = Branch(name=f"{name}'s branch")
    dept = Department(name=f"{name}'s department")
    db.add_all([branch, dept])
    await db.flush()
    employee = Employee(
        full_name=name, branch_id=branch.id, department_id=dept.id, joined_ad=date(2026, 1, 1)
    )
    db.add(employee)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=employee.id,
            pay_type=pay_type,
            basic=amount,
            ot_rate=ot_rate,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()
    return employee


async def _old_mark(db, employee, day, status="P", hours=0):
    db.add(
        Record(
            employee_id=employee.id,
            date=day,
            status=status,
            overtime_hours=hours,
            branch_id=employee.branch_id,
            source="manual",
            created_at=bsdate.utc_now() - timedelta(days=20),
        )
    )
    await db.flush()


async def _sign_in(client, db, make_user, login, employee, name="owner", super_admin=True):
    user = await make_user(name, role="admin")
    user.is_super_admin = super_admin
    user.active_branch_id = employee.branch_id
    await db.flush()
    await login(name)
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _balance(client, employee, month=PREVIOUS):
    response = await client.get(
        "/api/payroll/balance",
        params={"employee_id": employee.id, "for_year": month[0], "for_month": month[1]},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _pay_salary(client, h, employee, amount, month=PREVIOUS):
    response = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": employee.id,
            "kind": "salary",
            "for_year": month[0],
            "for_month": month[1],
            "amount": amount,
            "payment_mode_id": 1,
        },
        headers=h,
    )
    assert response.status_code == 201, response.text


async def _preview(client, h, day, *changes):
    return await client.post(
        "/api/attendance/override-preview",
        json={
            "date_bs": bs(day),
            "changes": [
                {"employee_id": e.id, "status": status, "ot_hours": hours}
                for e, status, hours in changes
            ],
        },
        headers=h,
    )


async def _override(client, h, employee, day, status, hours=0, reason=REASON):
    return await client.post(
        "/api/attendance/mark",
        json={
            "date_bs": bs(day),
            "employee_id": employee.id,
            "status": status,
            "ot_hours": hours,
            "reason": reason,
        },
        headers=h,
    )


# ------------------------------------------------------------------- the due is recalculated


async def test_the_due_changes_after_an_override(client, db, make_user, login):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY)
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, anita, 25000)
    before = await _balance(client, anita)
    assert (before["earned"], before["paid"], before["due"]) == (30000, 25000, 5000)

    changed = await _override(client, h, anita, WORKDAY, "A")
    assert changed.status_code == 200, changed.text
    after = await _balance(client, anita)
    assert (after["earned"], after["paid"], after["due"]) == (29000, 25000, 4000)
    assert after["status"] == "part_paid"

    # ... and back up again with overtime on another day (2 h x Rs 125).
    more = await _override(client, h, anita, OTHER_DAY, "O", 2, "Stayed for stock taking")
    assert more.status_code == 200, more.text
    assert (await _balance(client, anita))["due"] == 4250


async def test_an_override_can_leave_a_paid_month_overpaid_and_is_not_blocked(
    client, db, make_user, login
):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY)
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, anita, 30000)
    assert (await _balance(client, anita))["status"] == "paid"
    changed = await _override(client, h, anita, WORKDAY, "A")
    assert changed.status_code == 200, changed.text
    after = await _balance(client, anita)
    assert (after["earned"], after["paid"], after["due"]) == (29000, 30000, 0)


# -------------------------------------------------------------------------------- the warning


async def test_preview_warns_when_the_month_is_already_paid(client, db, make_user, login):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY)
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, anita, 25000)
    response = await _preview(client, h, WORKDAY, (anita, "A", 0))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["date"] == WORKDAY.isoformat() and body["date_bs"] == bs(WORKDAY)
    warning = (
        f"{LABEL} salary is already paid. This changes the net pay by Rs -1,000; "
        "the due will become Rs 4,000."
    )
    assert body["warning"] == warning
    assert body["items"] == [
        {
            "employee_id": anita.id,
            "name": "Anita",
            "old_status": "P",
            "old_hours": 0,
            "new_status": "A",
            "new_hours": 0,
            "payroll": {
                "month_label": LABEL,
                "for_year": PREVIOUS[0],
                "for_month": PREVIOUS[1],
                "paid": 25000,
                "net_before": 30000,
                "net_after": 29000,
                "net_change": -1000,
                "due_before": 5000,
                "due_after": 4000,
                "overpaid": 0,
                "warning": warning,
            },
        }
    ]
    # The preview writes nothing: the day and the due are as they were.
    assert (await _balance(client, anita))["due"] == 5000
    # What it promised is what the change then does.
    assert (await _override(client, h, anita, WORKDAY, "A")).status_code == 200
    assert (await _balance(client, anita))["due"] == 4000


async def test_preview_says_when_the_month_ends_up_overpaid(client, db, make_user, login):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY)
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, anita, 30000)
    body = (await _preview(client, h, WORKDAY, (anita, "A", 0))).json()
    assert body["warning"] == (
        f"{LABEL} salary is already paid. This changes the net pay by Rs -1,000; "
        "the due will become Rs 0. Rs 1,000 is already paid above the new net pay."
    )
    assert body["items"][0]["payroll"]["overpaid"] == 1000


async def test_preview_overtime_and_removal(client, db, make_user, login):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY, "A")
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, anita, 10000)
    overtime = (await _preview(client, h, WORKDAY, (anita, "O", 4))).json()
    assert overtime["warning"] == (
        f"{LABEL} salary is already paid. This changes the net pay by Rs +1,500; "
        "the due will become Rs 20,500."
    )
    removed = (await _preview(client, h, WORKDAY, (anita, None, 0))).json()
    item = removed["items"][0]
    assert (item["old_status"], item["new_status"]) == ("A", "N")
    # An absent day with its mark removed is "not marked": unpaid either way, the pay stays.
    assert item["payroll"]["net_change"] == 0 and removed["warning"] is None
    # A present day with its mark removed becomes unpaid.
    lost = (await _preview(client, h, OTHER_DAY, (anita, None, 0))).json()
    assert lost["items"][0]["payroll"]["net_change"] == -1000 and "Rs -1,000" in lost["warning"]


async def test_no_warning_when_nothing_is_paid_or_nothing_changes(client, db, make_user, login):
    anita = await _employee(db)
    await _old_mark(db, anita, WORKDAY)
    await attend(db, anita, PREVIOUS)  # present on every other working day
    h = await _sign_in(client, db, make_user, login, anita)
    unpaid = (await _preview(client, h, WORKDAY, (anita, "A", 0))).json()
    assert unpaid["warning"] is None
    payroll = unpaid["items"][0]["payroll"]
    assert payroll["warning"] is None and payroll["net_change"] == -1000 and payroll["paid"] == 0
    await _pay_salary(client, h, anita, 25000)
    # Present -> Present on another day: nothing moves, nothing to warn about.
    same = (await _preview(client, h, OTHER_DAY, (anita, "P", 0))).json()
    assert same["warning"] is None and same["items"][0]["payroll"]["net_change"] == 0


async def test_preview_for_a_bulk_change_names_each_person(client, db, make_user, login):
    anita = await _employee(db)
    daily = Employee(
        full_name="Dinesh",
        branch_id=anita.branch_id,
        department_id=anita.department_id,
        joined_ad=date(2026, 1, 1),
    )
    db.add(daily)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=daily.id,
            pay_type=PayType.daily,
            basic=800,
            ot_rate=100,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await _old_mark(db, daily, OTHER_DAY)  # one day worked: Rs 800 earned
    h = await _sign_in(client, db, make_user, login, anita)
    await _pay_salary(client, h, daily, 500)
    body = (await _preview(client, h, WORKDAY, (anita, "P", 0), (daily, "P", 0))).json()
    assert [i["name"] for i in body["items"]] == ["Anita", "Dinesh"]
    assert body["warning"] == (
        f"Dinesh: {LABEL} salary is already paid. This changes the net pay by Rs +800; "
        "the due will become Rs 1,100."
    )


async def test_preview_without_a_salary_has_no_payroll_part(client, db, make_user, login):
    anita = await _employee(db)
    nobody = Employee(
        full_name="No Salary Yet",
        branch_id=anita.branch_id,
        department_id=anita.department_id,
        joined_ad=date(2026, 1, 1),
    )
    db.add(nobody)
    await db.flush()
    h = await _sign_in(client, db, make_user, login, anita)
    body = (await _preview(client, h, WORKDAY, (nobody, "P", 0))).json()
    assert body["warning"] is None and body["items"][0]["payroll"] is None


async def test_preview_is_for_the_super_admin_and_never_for_the_future(
    client, db, make_user, login
):
    anita = await _employee(db)
    h = await _sign_in(client, db, make_user, login, anita, name="chief", super_admin=False)
    denied = await _preview(client, h, WORKDAY, (anita, "A", 0))
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Only the super admin can change past attendance."
    await client.post("/api/auth/logout", headers=h)
    h = await _sign_in(client, db, make_user, login, anita)
    tomorrow = bsdate.today_ad() + timedelta(days=1)
    future = await _preview(client, h, tomorrow, (anita, "P", 0))
    assert future.status_code == 403 and future.json()["code"] == "future_date"
    bad = await _preview(client, h, WORKDAY, (anita, "P", 3))
    assert bad.status_code == 200  # hours are ignored unless the new mark is Overtime
    saturday = next(d for d in DAYS if bsdate.weekday_index(d) == 6)
    absent = await _preview(client, h, saturday, (anita, "A", 0))
    assert absent.status_code == 422 and "weekly off" in absent.json()["detail"]
