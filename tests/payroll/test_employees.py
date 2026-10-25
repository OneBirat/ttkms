"""/api/payroll/employees: permissions, branch scoping, create / update / deactivate, barcodes,
salary history."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, Department, Employee, EmployeeStatus, User
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import effective_access
from app.modules.payroll.models import SalaryHistory

pytestmark = pytest.mark.anyio


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _org(db):
    main = Branch(name="Main branch")
    second = Branch(name="Branch 2")
    store = Department(name="Store")
    kitchen = Department(name="Kitchen")
    db.add_all([main, second, store, kitchen])
    await db.flush()
    return main, second, store, kitchen


async def _employee(db, branch, department, name="Sita Thapa", phone=None) -> Employee:
    from datetime import date

    employee = Employee(
        full_name=name,
        branch_id=branch.id,
        department_id=department.id,
        phone=phone,
        joined_ad=date(2026, 1, 1),
    )
    db.add(employee)
    await db.flush()
    await db.refresh(employee)
    return employee


async def _salary(db, employee, basic=22000, pay_type="monthly", ot_rate=92):
    from datetime import date

    from app.modules.payroll.models import PayType

    row = SalaryHistory(
        employee_id=employee.id,
        pay_type=PayType(pay_type),
        basic=basic,
        ot_rate=ot_rate,
        default_payment_mode_id=1,
        effective_ad=date(2026, 1, 1),
    )
    db.add(row)
    await db.flush()
    return row


async def _login(client, make_user, login, username, role, branch_id=None, switches=None):
    user = await make_user(username, role=role)
    if branch_id is not None or switches:
        db_access = effective_access(role, switches) if switches else None
        await _access_row(client, user, branch_id, db_access)
    await login(username)
    return {"X-CSRF-Token": await _csrf(client)}


async def _access_row(client, user, branch_id, access):
    # The test client shares the session fixture `db`; reach it through the app override.
    from app.db import get_db

    gen = client._transport.app.dependency_overrides[get_db]()  # type: ignore[attr-defined]
    db = await gen.__anext__()
    db.add(UserAccess(user_id=user.id, branch_id=branch_id, access=access))
    await db.flush()


def _payload(branch, department, **extra):
    base = {
        "full_name": "  Anita   Gurung ",
        "phone": "9841 203 311",
        "branch_id": branch.id,
        "department_id": department.id,
        "designation": "Store keeper",
        "pay_type": "monthly",
        "amount": 22000,
        "joined_bs": "2083-07-01",
    }
    base.update(extra)
    return base


async def test_staff_get_403(client, db, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    assert (await client.get("/api/payroll/employees")).status_code == 403


async def test_manager_sees_own_branch_without_money_fields(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    mine = await _employee(db, main, store, "Mine")
    other = await _employee(db, second, kitchen, "Other")
    await _salary(db, mine)
    headers = await _login(client, make_user, login, "boss", "manager", branch_id=main.id)
    rows = (await client.get(f"/api/payroll/employees?branch_id={second.id}")).json()
    assert [r["employee"]["full_name"] for r in rows] == ["Mine"]  # ?branch_id= is ignored
    row = rows[0]
    assert row["pay_type"] is None and row["rate"] is None and row["balance_due"] is None
    assert row["today"] in {"present", "overtime", "absent", "not_marked", "weekly_off"}
    assert row["employee"]["barcode"] == f"TTK-{mine.code.replace('-', '')}"
    assert (await client.get(f"/api/payroll/employees/{other.id}")).status_code == 403
    assert (await client.get(f"/api/payroll/employees/{mine.id}")).status_code == 200
    # Cannot add to or move into the other branch.
    bad = await client.post(
        "/api/payroll/employees", json=_payload(second, kitchen), headers=headers
    )
    assert bad.status_code == 422 and bad.json()["field"] == "branch_id"


async def test_admin_sees_everyone_with_money_fields(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    a = await _employee(db, main, store, "A")
    b = await _employee(db, second, kitchen, "B")
    await _salary(db, a)
    await _salary(db, b, basic=650, pay_type="daily", ot_rate=81)
    await _login(client, make_user, login, "admin", "admin")
    rows = (await client.get("/api/payroll/employees")).json()
    assert [r["employee"]["full_name"] for r in rows] == ["A", "B"]
    assert rows[0]["pay_type"] == "monthly" and rows[0]["rate"] == 22000
    assert rows[1]["pay_type"] == "daily" and rows[1]["rate"] == 650
    assert all(isinstance(r["balance_due"], int) and r["balance_due"] >= 0 for r in rows)
    only = (await client.get(f"/api/payroll/employees?branch_id={second.id}")).json()
    assert [r["employee"]["full_name"] for r in only] == ["B"]
    assert (await client.get("/api/payroll/employees?branch_id=999")).status_code == 404
    assert (await client.get("/api/payroll/employees?q=b")).json()[0]["employee"][
        "full_name"
    ] == "B"


async def test_create_employee_with_login_and_salary(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    headers = await _login(client, make_user, login, "admin", "admin")
    before = (await client.get("/api/payroll/employees/next-code")).json()
    payload = _payload(
        main, store, login={"username": "anita.g", "role": "staff"}, full_name_np="अनिता गुरुङ"
    )
    created = await client.post("/api/payroll/employees", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    e = body["employee"]
    assert (
        e["code"] == before["code"]
        and e["barcode"] == before["barcode"] == f"TTK-{e['code'].replace('-', '')}"
    )
    assert (
        e["full_name"] == "Anita Gurung"
        and e["phone"] == "9841203311"
        and e["full_name_np"] == "अनिता गुरुङ"
    )
    assert e["joined"] == {"bs": "2083-07-01", "ad": "2026-10-18"}
    assert e["branch"]["name"] == "Main branch" and e["department"] == {
        "id": store.id,
        "name": "Store",
    }
    assert e["active"] is True and e["photo_url"] is None
    assert e["login"]["username"] == "anita.g" and e["login"]["role"] == "staff"
    temporary = body["one_time_password"]
    assert temporary and len(temporary) == 10
    user = await db.scalar(select(User).where(User.username == "anita.g"))
    assert (
        user.must_change_password is True
        and user.employee_id == e["id"]
        and user.phone == "9841203311"
    )
    access = await db.get(UserAccess, user.id)
    assert access.branch_id == main.id
    salary = (await client.get(f"/api/payroll/employees/{e['id']}/salary")).json()
    assert (
        salary["current"]["gross"] == 22000 and salary["current"]["ot_rate"] == 92
    )  # 22000 / 30 / 8
    assert salary["current"]["default_payment_mode"]["name"] == "Cash"
    assert (
        salary["current"]["effective_from"]["bs"] == "2083-07-01"
        and salary["current"]["previous_gross"] is None
    )
    audit = (await db.execute(select(AuditLog).where(AuditLog.module == "payroll"))).scalars().all()
    assert [a.action for a in audit] == ["create"] and audit[0].data["after"][
        "phone"
    ] == "9841203311"
    # Duplicate phone among active staff -> 409 with the field; a username clash too.
    dup = await client.post(
        "/api/payroll/employees", json=_payload(main, store, full_name="Twin"), headers=headers
    )
    assert (
        dup.status_code == 409
        and dup.json()["code"] == "duplicate_phone"
        and dup.json()["field"] == "phone"
    )
    clash = await client.post(
        "/api/payroll/employees",
        json=_payload(
            main, store, phone="9841000009", login={"username": "ANITA.G", "role": "staff"}
        ),
        headers=headers,
    )
    assert clash.status_code == 409 and clash.json()["code"] == "duplicate_username"
    bad_phone = await client.post(
        "/api/payroll/employees", json=_payload(main, store, phone="12345"), headers=headers
    )
    assert bad_phone.status_code == 422 and bad_phone.json()["field"] == "phone"
    future = await client.post(
        "/api/payroll/employees",
        json=_payload(main, store, phone="9841000008", joined_bs="2099-01-01"),
        headers=headers,
    )
    assert future.status_code == 422 and future.json()["field"] == "joined_bs"
    assert (await client.get("/api/payroll/employees/next-code")).json()["code"] != before["code"]


async def test_update_and_deactivate_free_the_phone(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    employee = await _employee(db, main, store, phone="9841000001")
    headers = await _login(client, make_user, login, "admin", "admin")
    update = {
        "full_name": "Sita Thapa Magar",
        "full_name_np": None,
        "phone": "9841000001",
        "phone_alt": "9800000000",
        "address": "Balaju",
        "branch_id": second.id,
        "department_id": kitchen.id,
        "designation": "Cook",
        "active": True,
        "joined_bs": "2083-01-01",
    }
    updated = await client.patch(
        f"/api/payroll/employees/{employee.id}", json=update, headers=headers
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["full_name"] == "Sita Thapa Magar" and body["branch"]["name"] == "Branch 2"
    assert (
        body["department"]["name"] == "Kitchen"
        and body["address"] == "Balaju"
        and body["joined"]["bs"] == "2083-01-01"
    )
    off = await client.post(f"/api/payroll/employees/{employee.id}/deactivate", headers=headers)
    assert off.status_code == 200 and off.json()["active"] is False
    await db.refresh(employee)
    assert employee.status == EmployeeStatus.inactive and employee.deactivated_at is not None
    # The number is free for a new active employee now.
    again = await client.post(
        "/api/payroll/employees", json=_payload(main, store, phone="9841000001"), headers=headers
    )
    assert again.status_code == 201, again.text
    actions = (
        (
            await db.execute(
                select(AuditLog.action).where(AuditLog.module == "payroll").order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["update", "deactivate", "create"]
    assert (await client.get("/api/payroll/employees?active=0")).json()[0]["employee"][
        "id"
    ] == employee.id


async def test_barcode_lookup_accepts_both_sticker_formats(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    employee = await _employee(db, main, store)
    former = await _employee(db, main, store, "Old")
    former.status = EmployeeStatus.inactive
    await db.flush()
    await _login(client, make_user, login, "admin", "admin")
    digits = employee.code.split("-")[1]
    for raw in (
        f"TTK-E{digits}",
        f"TTK-E-{digits}",
        f"ttk-e{digits}",
        f"E-{digits}",
        digits.lstrip("0") or "0",
    ):
        response = await client.get(f"/api/payroll/employees/by-barcode/{raw}")
        assert response.status_code == 200, (raw, response.text)
        assert response.json()["id"] == employee.id
    assert (await client.get("/api/payroll/employees/by-barcode/TTK-X917")).status_code == 404
    assert (
        await client.get(f"/api/payroll/employees/by-barcode/{former.barcode}")
    ).status_code == 404
    # Managers of another branch cannot look up this card.
    await client.post("/api/auth/logout", headers={"X-CSRF-Token": await _csrf(client)})
    await _login(client, make_user, login, "boss", "manager", branch_id=second.id)
    assert (
        await client.get(f"/api/payroll/employees/by-barcode/{employee.barcode}")
    ).status_code == 403


async def test_salary_revision_history_and_default_rate(client, db, make_user, login):
    main, second, store, kitchen = await _org(db)
    employee = await _employee(db, main, store)
    await _salary(db, employee, basic=22000)
    headers = await _login(client, make_user, login, "admin", "admin")
    revised = await client.post(
        f"/api/payroll/employees/{employee.id}/salary",
        json={
            "pay_type": "monthly",
            "basic": 24000,
            "allowances": 1000,
            "effective_from_bs": "2083-07-01",
            "reason": "Annual",
        },
        headers=headers,
    )
    assert revised.status_code == 201, revised.text
    current = revised.json()["current"]
    assert current["gross"] == 25000 and current["ot_rate"] == 104  # 25000 / 30 / 8
    assert current["previous_gross"] == 22000 and current["reason"] == "Annual"
    assert [h["gross"] for h in revised.json()["history"]] == [25000, 22000]
    explicit = await client.post(
        f"/api/payroll/employees/{employee.id}/salary",
        json={
            "pay_type": "daily",
            "basic": 700,
            "ot_rate": 90,
            "effective_from_bs": "2083-08-01",
            "default_payment_mode_id": 1,
        },
        headers=headers,
    )
    assert (
        explicit.json()["current"]["ot_rate"] == 90 and explicit.json()["current"]["gross"] == 700
    )
    early = await client.post(
        f"/api/payroll/employees/{employee.id}/salary",
        json={"pay_type": "monthly", "basic": 1, "effective_from_bs": "2070-01-01"},
        headers=headers,
    )
    assert early.status_code == 422 and early.json()["field"] == "effective_from_bs"
    actions = (
        (
            await db.execute(
                select(AuditLog.action).where(AuditLog.entity == "salary").order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["revise", "revise"]
