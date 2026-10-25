"""A month without a ledger says why: no salary set up yet (offer the Salary tab) or a month
before the joining date - never the joining-date text for an employee who simply has no salary."""

from datetime import date

import pytest

from app.core import bsdate
from app.core.models import Branch, Employee
from app.modules.payroll.models import PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)


async def _employee(db, joined: date, salary: bool):
    branch = Branch(name="Main branch")
    db.add(branch)
    await db.flush()
    e = Employee(full_name="Ram", branch_id=branch.id, joined_ad=joined)
    db.add(e)
    await db.flush()
    if salary:
        db.add(
            SalaryHistory(
                employee_id=e.id,
                pay_type=PayType.monthly,
                basic=30000,
                ot_rate=125,
                effective_ad=joined,
            )
        )
        await db.flush()
    return e


async def _balance(client, e, month):
    return await client.get(
        "/api/payroll/balance",
        params={"employee_id": e.id, "for_year": month[0], "for_month": month[1]},
    )


async def test_no_salary_set_up_yet(client, db, make_user, login):
    e = await _employee(db, date(2026, 1, 1), salary=False)
    await make_user("admin", role="admin")
    await login("admin")
    response = await _balance(client, e, CURRENT)
    assert response.status_code == 404
    assert response.json() == {
        "detail": "No salary set up yet — add it in the Salary tab.",
        "code": "no_salary",
        "employee_id": e.id,
    }
    ledger = await client.get(f"/api/payroll/employees/{e.id}/ledger/{CURRENT[0]}-{CURRENT[1]:02d}")
    assert ledger.status_code == 404 and ledger.json()["code"] == "no_salary"


async def test_before_the_joining_date_keeps_its_text(client, db, make_user, login):
    joined = bsdate.bs_month_range(*CURRENT)[0]  # the 1st of the running month
    e = await _employee(db, joined, salary=True)
    await make_user("admin", role="admin")
    await login("admin")
    earlier = await _balance(client, e, bsdate.shift_month(*CURRENT, -1))
    assert earlier.status_code == 404
    assert earlier.json()["code"] == "before_joining"
    assert earlier.json()["detail"] == "No salary for this month (before the joining date)."
    assert (await _balance(client, e, CURRENT)).status_code == 200
