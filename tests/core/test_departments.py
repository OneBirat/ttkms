"""/api/core/departments: list with counts, add, rename, delete, the 409 codes, permissions."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, Department, Employee, EmployeeStatus

pytestmark = pytest.mark.anyio


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _manager(client, make_user, login, username="boss"):
    await make_user(username, role="manager")
    await login(username)
    return {"X-CSRF-Token": await _csrf(client)}


async def _department(db, name) -> Department:
    department = Department(name=name)
    db.add(department)
    await db.flush()
    return department


async def _employee(db, department, status=EmployeeStatus.active, name="Sita Thapa") -> Employee:
    branch = await db.scalar(select(Branch).limit(1))
    if branch is None:
        branch = Branch(name="Main branch")
        db.add(branch)
        await db.flush()
    employee = Employee(
        full_name=name, branch_id=branch.id, department_id=department.id, status=status
    )
    db.add(employee)
    await db.flush()
    return employee


async def test_list_has_counts_including_former_staff(client, db, make_user, login):
    store = await _department(db, "Store")
    kitchen = await _department(db, "Kitchen")
    await _employee(db, store)
    await _employee(db, store, EmployeeStatus.inactive, "Ram Gurung")
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/api/core/departments")
    assert response.status_code == 200
    rows = {row["name"]: row for row in response.json()}
    assert list(rows) == ["Kitchen", "Store"]  # A-Z
    assert rows["Store"] == {
        "id": store.id,
        "name": "Store",
        "employee_count": 2,
        "active_employee_count": 1,
    }
    assert rows["Kitchen"]["employee_count"] == 0 and rows["Kitchen"]["id"] == kitchen.id
    assert "is_active" not in rows["Store"]


async def test_create_trims_and_refuses_duplicates_case_insensitively(client, db, make_user, login):
    headers = await _manager(client, make_user, login)
    created = await client.post(
        "/api/core/departments", json={"name": "  Front   desk "}, headers=headers
    )
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "Front desk"
    assert created.json()["employee_count"] == 0
    duplicate = await client.post(
        "/api/core/departments", json={"name": "FRONT DESK"}, headers=headers
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_name"
    empty = await client.post("/api/core/departments", json={"name": "   "}, headers=headers)
    assert empty.status_code == 422
    audit = (
        (await db.execute(select(AuditLog).where(AuditLog.entity == "department"))).scalars().all()
    )
    assert [(a.module, a.action, a.data) for a in audit] == [
        ("core", "create", {"after": {"name": "Front desk"}})
    ]


async def test_rename(client, db, make_user, login):
    headers = await _manager(client, make_user, login)
    store = await _department(db, "Store")
    await _department(db, "Kitchen")
    await _employee(db, store)
    renamed = await client.patch(
        f"/api/core/departments/{store.id}", json={"name": "Stores"}, headers=headers
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json() == {
        "id": store.id,
        "name": "Stores",
        "employee_count": 1,
        "active_employee_count": 1,
    }
    clash = await client.patch(
        f"/api/core/departments/{store.id}", json={"name": "kitchen"}, headers=headers
    )
    assert clash.status_code == 409 and clash.json()["code"] == "duplicate_name"
    same = await client.patch(
        f"/api/core/departments/{store.id}", json={"name": "Stores"}, headers=headers
    )
    assert same.status_code == 200
    missing = await client.patch(
        "/api/core/departments/999999", json={"name": "X"}, headers=headers
    )
    assert missing.status_code == 404
    audit = (await db.execute(select(AuditLog).where(AuditLog.action == "rename"))).scalars().all()
    assert [a.data for a in audit] == [{"before": {"name": "Store"}, "after": {"name": "Stores"}}]


async def test_delete_empty_department_is_gone(client, db, make_user, login):
    headers = await _manager(client, make_user, login)
    spare = await _department(db, "Spare")
    response = await client.delete(f"/api/core/departments/{spare.id}", headers=headers)
    assert response.status_code == 204
    assert await db.get(Department, spare.id) is None
    assert spare.id not in {row["id"] for row in (await client.get("/api/core/departments")).json()}
    again = await client.delete(f"/api/core/departments/{spare.id}", headers=headers)
    assert again.status_code == 404
    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "delete"))
    assert audit.entity == "department" and audit.entity_id == str(spare.id)
    assert audit.data == {"before": {"name": "Spare"}}


@pytest.mark.parametrize("status", [EmployeeStatus.active, EmployeeStatus.inactive])
async def test_delete_refused_while_any_employee_references_it(
    client, db, make_user, login, status
):
    headers = await _manager(client, make_user, login)
    store = await _department(db, "Store")
    await _employee(db, store, status)
    response = await client.delete(f"/api/core/departments/{store.id}", headers=headers)
    assert response.status_code == 409
    assert response.json() == {
        "detail": "Move the employees of this department first.",
        "code": "department_in_use",
        "count": 1,
        "inactive_count": 1 if status is EmployeeStatus.inactive else 0,
    }
    assert await db.get(Department, store.id) is not None
    assert await db.scalar(select(AuditLog).where(AuditLog.action == "delete")) is None


async def test_staff_can_list_but_not_change(client, db, make_user, login):
    store = await _department(db, "Store")
    await make_user("clerk", role="staff")
    await login("clerk")
    headers = {"X-CSRF-Token": await _csrf(client)}
    assert (await client.get("/api/core/departments")).status_code == 200
    assert (
        await client.post("/api/core/departments", json={"name": "New"}, headers=headers)
    ).status_code == 403
    assert (
        await client.patch(f"/api/core/departments/{store.id}", json={"name": "X"}, headers=headers)
    ).status_code == 403
    assert (
        await client.delete(f"/api/core/departments/{store.id}", headers=headers)
    ).status_code == 403
    assert (await db.get(Department, store.id)).name == "Store"


async def test_anonymous_gets_401(client):
    assert (await client.get("/api/core/departments")).status_code == 401
