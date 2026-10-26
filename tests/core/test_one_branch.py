"""ONE active branch for the whole app: every branch-aware endpoint answers for the user's active
branch when no branch is asked for, switching it switches every answer, and nobody without
see_other_branches can switch or read another branch."""

from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook

from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import effective_access
from app.modules.attendance.models import Record
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource, PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
KEY = f"{TODAY.year}-{TODAY.month:02d}"


async def _world(db):
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store = Department(name="Store")
    db.add_all([main, second, store])
    await db.flush()
    people = {}
    for name, branch, status, paid in (("Anita", main, "P", 100), ("Mina", second, "A", 200)):
        e = Employee(
            full_name=name, branch_id=branch.id, department_id=store.id, joined_ad=date(2026, 1, 1)
        )
        db.add(e)
        await db.flush()
        db.add(
            SalaryHistory(
                employee_id=e.id,
                pay_type=PayType.monthly,
                basic=30000,
                ot_rate=125,
                default_payment_mode_id=1,
                effective_ad=date(2026, 1, 1),
            )
        )
        db.add(
            Record(
                employee_id=e.id,
                branch_id=branch.id,
                date=bsdate.today_ad(),
                status=status,
                overtime_hours=0,
                source="manual",
            )
        )
        db.add(
            Payment(
                receipt_no=f"ADV-90{e.id:02d}",
                employee_id=e.id,
                branch_id=branch.id,
                kind=PaymentKind.advance,
                for_year=TODAY.year,
                for_month=TODAY.month,
                amount=paid,
                payment_mode_id=1,
                date=bsdate.today_ad(),
                source=PaymentSource.account,
            )
        )
        people[name] = e
    await db.flush()
    return main, second, people


async def _csrf(client) -> dict:
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _snapshot(client, people, branch_param: int | None = None, admin: bool = True) -> dict:
    """Who / what every branch-aware endpoint returns right now."""
    extra = {} if branch_param is None else {"branch_id": branch_param}
    att_extra = {} if branch_param is None else {"branch": branch_param}
    out = {}
    counts = (await client.get("/api/today")).json()["counts"]
    out["today"] = (counts["total"], counts["present"], counts["absent"], counts["paid_today"])
    widgets = {
        w["module"]: w["data"] for w in (await client.get("/api/dashboard")).json()["widgets"]
    }
    out["att_widget"] = widgets["attendance"]["total"]
    out["pay_widget"] = [p["name"] for p in widgets["payroll"]["payments"]]
    day = await client.get(
        "/api/attendance/day", params={"date_bs": TODAY.isoformat(), **att_extra}
    )
    out["day"] = [r["employee"]["name"] for r in day.json()["rows"]]
    report = await client.get(
        "/api/attendance/report",
        params={"bs_year": TODAY.year, "bs_month": TODAY.month, **att_extra},
    )
    out["att_report"] = [r["employee"]["name"] for r in report.json()["rows"]]
    out["employees"] = [
        r["employee"]["full_name"]
        for r in (await client.get("/api/payroll/employees", params=extra)).json()
    ]
    salary = (await client.get(f"/api/payroll/report/{KEY}", params=extra)).json()
    out["salary_report"] = [r["employee"]["full_name"] for r in salary["rows"]]
    payments = (await client.get("/api/payroll/payments", params=extra)).json()
    out["payments"] = sorted(r["employee"]["full_name"] for r in payments["rows"])
    xlsx = await client.get("/api/payroll/payments/export.xlsx", params=extra)
    out["export"] = load_workbook(BytesIO(xlsx.content))["Payments"]["A1"].value.split(" · ")[2]
    lookups = {}
    for name, e in people.items():
        lookups[name] = (
            await client.get("/api/attendance/lookup", params={"employee_id": e.id})
        ).status_code
    out["lookup"] = lookups
    if admin:
        barcodes = (await client.get("/api/admin/barcodes")).json()
        out["barcodes"] = [e["full_name"] for e in barcodes["employees"]]
    return out


MAIN_VIEW = {
    "today": (1, 1, 0, 100),
    "att_widget": 1,
    "pay_widget": ["Anita"],
    "day": ["Anita"],
    "att_report": ["Anita"],
    "employees": ["Anita"],
    "salary_report": ["Anita"],
    "payments": ["Anita"],
    "export": "Main branch",
    "lookup": {"Anita": 200, "Mina": 403},
}


async def test_switching_branch_changes_what_every_endpoint_returns(client, db, make_user, login):
    main, second, people = await _world(db)
    await make_user("admin", role="admin")
    await login("admin")
    before = await _snapshot(client, people)
    assert before == {**MAIN_VIEW, "barcodes": ["Anita"]}

    switched = await client.put(
        "/api/me/active-branch", json={"branch_id": second.id}, headers=await _csrf(client)
    )
    assert switched.status_code == 200
    after = await _snapshot(client, people)
    assert after == {
        "today": (1, 0, 1, 200),
        "att_widget": 1,
        "pay_widget": ["Mina"],
        "day": ["Mina"],
        "att_report": ["Mina"],
        "employees": ["Mina"],
        "salary_report": ["Mina"],
        "payments": ["Mina"],
        "export": "Branch 2",
        "lookup": {"Anita": 403, "Mina": 200},
        "barcodes": ["Mina"],
    }


async def test_without_see_other_branches_nobody_switches_or_reads_another_branch(
    client, db, make_user, login
):
    main, second, people = await _world(db)
    boss = await make_user("boss", role="manager")
    db.add(
        UserAccess(
            user_id=boss.id,
            branch_id=main.id,
            access=effective_access("manager", {"salary_advances": True}),
        )
    )
    await db.flush()
    await login("boss")
    # Asking for Branch 2 everywhere changes nothing: it is ignored.
    assert await _snapshot(client, people, second.id, admin=False) == MAIN_VIEW
    h = await _csrf(client)
    refused = await client.put("/api/me/active-branch", json={"branch_id": second.id}, headers=h)
    assert refused.status_code == 403
    mina = people["Mina"]
    for path in (
        f"/api/payroll/employees/{mina.id}",
        f"/api/payroll/employees/{mina.id}/ledger",
        f"/api/attendance/employees/{mina.id}/month?bs_year={TODAY.year}&bs_month={TODAY.month}",
    ):
        response = await client.get(path)
        assert response.status_code == 403, path
        assert "Branch 2" in response.json()["detail"]
    marked = await client.post(
        "/api/attendance/mark",
        json={"date_bs": TODAY.isoformat(), "employee_id": mina.id, "status": "P"},
        headers=h,
    )
    assert marked.status_code == 403
