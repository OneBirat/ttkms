"""/api/core/branches: list with counts, add, rename, (de)activate, the 409 codes, permissions."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, Employee, EmployeeStatus

pytestmark = pytest.mark.anyio


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _manager(client, make_user, login, username="boss"):
    await make_user(username, role="manager")
    await login(username)
    return {"X-CSRF-Token": await _csrf(client)}


async def _branch(db, name, active=True) -> Branch:
    branch = Branch(name=name, is_active=active)
    db.add(branch)
    await db.flush()
    return branch


async def test_list_counts_and_active_filter(client, db, make_user, login):
    main = await _branch(db, "Main branch")
    old = await _branch(db, "Old shop", active=False)
    db.add_all(
        [
            Employee(full_name="A", branch_id=main.id),
            Employee(full_name="B", branch_id=main.id, status=EmployeeStatus.inactive),
        ]
    )
    await db.flush()
    await make_user("clerk", role="staff")
    await login("clerk")
    rows = {r["name"]: r for r in (await client.get("/api/core/branches")).json()}
    assert rows["Main branch"] == {
        "id": main.id,
        "name": "Main branch",
        "is_active": True,
        "employee_count": 2,
        "active_employee_count": 1,
    }
    assert rows["Old shop"]["is_active"] is False and rows["Old shop"]["id"] == old.id
    active = (await client.get("/api/core/branches?active=1")).json()
    assert [r["name"] for r in active] == ["Main branch"]


async def test_create_rename_and_duplicates(client, db, make_user, login):
    headers = await _manager(client, make_user, login)
    created = await client.post(
        "/api/core/branches", json={"name": "  Pokhara   shop "}, headers=headers
    )
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "Pokhara shop" and created.json()["is_active"] is True
    dup = await client.post("/api/core/branches", json={"name": "POKHARA SHOP"}, headers=headers)
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_name"
    other = await _branch(db, "Butwal")
    clash = await client.patch(
        f"/api/core/branches/{other.id}", json={"name": "pokhara shop"}, headers=headers
    )
    assert clash.status_code == 409 and clash.json()["code"] == "duplicate_name"
    renamed = await client.patch(
        f"/api/core/branches/{other.id}", json={"name": "Butwal shop"}, headers=headers
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Butwal shop"
    assert (
        await client.patch("/api/core/branches/999999", json={"name": "X"}, headers=headers)
    ).status_code == 404
    assert (
        await client.post("/api/core/branches", json={"name": " "}, headers=headers)
    ).status_code == 422
    actions = (
        (
            await db.execute(
                select(AuditLog.action).where(AuditLog.entity == "branch").order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["create", "rename"]


async def test_deactivate_keeps_one_active_branch(client, db, make_user, login):
    headers = await _manager(client, make_user, login)
    main = await _branch(db, "Main branch")
    second = await _branch(db, "Branch 2")
    off = await client.patch(
        f"/api/core/branches/{second.id}", json={"is_active": False}, headers=headers
    )
    assert off.status_code == 200 and off.json()["is_active"] is False
    last = await client.patch(
        f"/api/core/branches/{main.id}", json={"is_active": False}, headers=headers
    )
    assert last.status_code == 409 and last.json()["code"] == "last_active_branch"
    on = await client.patch(
        f"/api/core/branches/{second.id}", json={"is_active": True}, headers=headers
    )
    assert on.status_code == 200 and on.json()["is_active"] is True
    actions = (
        (
            await db.execute(
                select(AuditLog.action).where(AuditLog.entity == "branch").order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["deactivate", "activate"]


async def test_staff_can_list_but_not_change(client, db, make_user, login):
    main = await _branch(db, "Main branch")
    await make_user("clerk", role="staff")
    await login("clerk")
    headers = {"X-CSRF-Token": await _csrf(client)}
    assert (await client.get("/api/core/branches")).status_code == 200
    assert (
        await client.post("/api/core/branches", json={"name": "New"}, headers=headers)
    ).status_code == 403
    assert (
        await client.patch(f"/api/core/branches/{main.id}", json={"name": "X"}, headers=headers)
    ).status_code == 403


async def test_employee_profile_columns(db):
    """core_0006: barcode is generated from the code, joined_ad defaults to today, one active
    employee per phone, one login per employee."""
    from sqlalchemy.exc import IntegrityError

    from app.core.models import User

    branch = await _branch(db, "Main branch")
    first = Employee(full_name="Ram Thapa", branch_id=branch.id, phone="9841000001")
    db.add(first)
    await db.flush()
    await db.refresh(first)
    assert first.barcode == f"TTK-{first.code.replace('-', '')}"
    assert first.joined_ad is not None and first.deactivated_at is None
    former = Employee(
        full_name="Old Ram", branch_id=branch.id, phone="9841000001", status=EmployeeStatus.inactive
    )
    db.add(former)
    await db.flush()  # a former employee may share the number
    db.add(Employee(full_name="Twin", branch_id=branch.id, phone="9841000001"))
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()
    branch = await _branch(db, "Main branch")
    emp = Employee(full_name="Ram Thapa", branch_id=branch.id)
    db.add(emp)
    await db.flush()
    db.add(User(username="ram", password_hash="x", full_name="Ram", employee_id=emp.id))
    await db.flush()
    db.add(User(username="ram2", password_hash="x", full_name="Ram 2", employee_id=emp.id))
    with pytest.raises(IntegrityError):
        await db.flush()
