"""/api/admin/users: list with effective access, create with a temporary password, edit,
activate / deactivate with the self and last-admin guards, reset password, audit rows."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, Employee, User
from tests.conftest import login_as

pytestmark = pytest.mark.anyio


async def _branch(db, name="Main branch") -> Branch:
    branch = Branch(name=name)
    db.add(branch)
    await db.flush()
    return branch


async def _employee(db, branch: Branch, name="Sita Thapa") -> Employee:
    employee = Employee(full_name=name, phone="9817044556", branch_id=branch.id)
    db.add(employee)
    await db.flush()
    return employee


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _post(client, path, json=None):
    return await client.post(path, json=json, headers={"X-CSRF-Token": await _csrf(client)})


async def _put(client, path, json):
    return await client.put(path, json=json, headers={"X-CSRF-Token": await _csrf(client)})


async def test_list_users_requires_manage_users(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    assert (await client.get("/api/admin/users")).status_code == 403
    assert (await client.get("/api/admin/users/options")).status_code == 403


async def test_list_users_shape(client, make_user, login, db):
    admin = await make_user("admin", full_name="Entro Owner")
    await make_user("sita", role="staff", full_name="Sita Thapa")
    await login("admin")
    body = (await client.get("/api/admin/users")).json()
    assert [u["full_name"] for u in body] == ["Entro Owner", "Sita Thapa"]
    me = body[0]
    assert me["id"] == admin.id and me["is_you"] is True and me["custom"] is False
    assert me["branch"] is None and me["employee"] is None and me["phone"] is None
    assert me["access"]["manage_users"] is True
    assert body[1]["is_you"] is False and body[1]["access"]["manage_users"] is False
    assert body[1]["access"]["mark_attendance"] is True
    assert "last_login_at_bs" in me and "must_change_password" in me


async def test_create_user_issues_a_temporary_password(client, make_user, login, db):
    await make_user("admin")
    branch = await _branch(db)
    employee = await _employee(db, branch)
    await login("admin")
    payload = {
        "full_name": "  Sita   Thapa ",
        "phone": "+977 9817-044556",
        "role": "staff",
        "branch_id": branch.id,
        "employee_id": employee.id,
        "access": {"view_attendance_report": True},
    }
    response = await _post(client, "/api/admin/users", payload)
    assert response.status_code == 201, response.text
    body = response.json()
    user = body["user"]
    assert user["full_name"] == "Sita Thapa" and user["phone"] == "9817044556"
    assert user["username"] == "9817044556"  # the phone is the login
    assert user["branch"] == {"id": branch.id, "name": "Main branch", "is_active": True}
    assert user["employee"]["code"].startswith("E-") and user["employee"]["user_id"] == user["id"]
    assert user["custom"] is True and user["access"]["view_attendance_report"] is True
    assert user["must_change_password"] is True
    temporary = body["temporary_password"]
    assert len(temporary) == 10 and temporary[4] == "-"

    # Options now mark the employee as linked.
    options = (await client.get("/api/admin/users/options")).json()
    assert options["branches"] == [{"id": branch.id, "name": "Main branch", "is_active": True}]
    assert options["employees"][0]["user_id"] == user["id"]

    # Audit: create with after-snapshot, no password anywhere.
    rows = (await db.execute(select(AuditLog).where(AuditLog.module == "admin"))).scalars().all()
    assert [r.action for r in rows] == ["create"]
    assert rows[0].data["before"] is None and rows[0].data["after"]["phone"] == "9817044556"
    assert "password" not in str(rows[0].data)

    # The new user signs in with phone + temporary password and must change it.
    await _post(client, "/api/auth/logout")
    session = await login_as(client, "9817 044 556", temporary)
    assert session.json()["user"]["must_change_password"] is True
    blocked = await client.get("/api/admin/users")
    assert blocked.status_code == 403 and blocked.json()["code"] == "password_change_required"


async def test_create_user_validation(client, make_user, login, db):
    await make_user("admin")
    branch = await _branch(db)
    other = await make_user("other", role="staff")
    other.phone = "9841000009"
    await db.flush()
    await login("admin")
    base = {"full_name": "X", "role": "staff", "branch_id": branch.id}

    bad_phone = await _post(client, "/api/admin/users", {**base, "phone": "12345"})
    assert bad_phone.status_code == 422
    assert "10-digit" in bad_phone.json()["detail"][0]["msg"]

    taken = await _post(client, "/api/admin/users", {**base, "phone": "9841000009"})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "This phone already has a login."

    no_branch = await _post(
        client, "/api/admin/users", {"full_name": "X", "role": "manager", "phone": "9841000010"}
    )
    assert no_branch.status_code == 422
    assert no_branch.json()["detail"] == "Pick the branch this user works in."

    # Admins never need a branch; one given is ignored (all branches).
    admin = await _post(
        client,
        "/api/admin/users",
        {
            "full_name": "Second Admin",
            "role": "admin",
            "phone": "9841000011",
            "branch_id": branch.id,
        },
    )
    assert admin.status_code == 201 and admin.json()["user"]["branch"] is None


async def test_update_user_access_and_role(client, make_user, login, db):
    admin = await make_user("admin")
    sita = await make_user("sita", role="staff", full_name="Sita Thapa")
    branch = await _branch(db)
    await login("admin")
    payload = {
        "full_name": "Sita Thapa",
        "phone": "9817044556",
        "role": "manager",
        "branch_id": branch.id,
        "employee_id": None,
        "access": {"salary_advances": True},
    }
    response = await _put(client, f"/api/admin/users/{sita.id}", payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "manager" and body["custom"] is True
    assert body["access"]["salary_advances"] is True and body["access"]["manage_employees"] is True
    assert body["phone"] == "9817044556" and body["username"] == "sita"  # username kept

    # "Reset to role": access null -> preset, custom false; audit has before/after.
    response = await _put(client, f"/api/admin/users/{sita.id}", {**payload, "access": None})
    assert response.json()["custom"] is False
    rows = (await db.execute(select(AuditLog).where(AuditLog.module == "admin"))).scalars().all()
    assert [r.action for r in rows] == ["update", "update"]
    assert rows[1].data["before"]["access"] is not None and rows[1].data["after"]["access"] is None
    assert all(r.user_id == admin.id for r in rows)

    # No change -> no audit row.
    await _put(client, f"/api/admin/users/{sita.id}", {**payload, "access": None})
    rows = (await db.execute(select(AuditLog).where(AuditLog.module == "admin"))).scalars().all()
    assert len(rows) == 2

    assert (await _put(client, "/api/admin/users/99999", payload)).status_code == 404


async def test_self_and_last_admin_guards(client, make_user, login, db):
    admin = await make_user("admin", full_name="Only Admin")
    sita = await make_user("sita", role="staff")
    await login("admin")
    me_payload = {"full_name": "Only Admin", "phone": "9841000001", "role": "manager"}

    demote = await _put(client, f"/api/admin/users/{admin.id}", {**me_payload, "branch_id": None})
    assert demote.status_code == 409
    assert demote.json()["detail"] == "You cannot remove your own admin role."

    off = await _post(client, f"/api/admin/users/{admin.id}/active", {"is_active": False})
    assert off.status_code == 409
    assert off.json()["detail"] == "You cannot deactivate your own account."

    # Another admin may deactivate the first one only while a second active admin exists.
    second = await make_user("second", role="admin")
    await _post(client, "/api/auth/logout")
    await login("second")
    off = await _post(client, f"/api/admin/users/{admin.id}/active", {"is_active": False})
    assert off.status_code == 200 and off.json()["is_active"] is False
    # Now "second" is the last active admin: cannot be demoted by anyone.
    await _post(client, "/api/auth/logout")
    await login("second")
    me = {"full_name": "Second", "phone": "9841000002", "role": "staff", "branch_id": None}
    last = await _put(client, f"/api/admin/users/{second.id}", me)
    assert last.status_code == 409  # self-demote fires first
    # Reactivate the first admin, then the guard allows changes again.
    on = await _post(client, f"/api/admin/users/{admin.id}/active", {"is_active": True})
    assert on.status_code == 200 and on.json()["is_active"] is True
    actions = (
        (await db.execute(select(AuditLog.action).where(AuditLog.module == "admin")))
        .scalars()
        .all()
    )
    assert actions == ["deactivate", "activate"]

    # Deactivating a staff user is unrestricted and they can no longer sign in.
    off = await _post(client, f"/api/admin/users/{sita.id}/active", {"is_active": False})
    assert off.status_code == 200
    await _post(client, "/api/auth/logout")
    token = await _csrf(client)
    denied = await client.post(
        "/api/auth/login",
        json={"username": "sita", "password": "secret123"},
        headers={"X-CSRF-Token": token},
    )
    assert denied.status_code == 401


async def test_reset_password(client, make_user, login, db):
    await make_user("admin")
    sita = await make_user("sita", role="staff", full_name="Sita Thapa")
    await login("admin")
    response = await _post(client, f"/api/admin/users/{sita.id}/reset-password")
    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == sita.id and body["full_name"] == "Sita Thapa"
    temporary = body["temporary_password"]
    await _post(client, "/api/auth/logout")

    token = await _csrf(client)
    old = await client.post(
        "/api/auth/login",
        json={"username": "sita", "password": "secret123"},
        headers={"X-CSRF-Token": token},
    )
    assert old.status_code == 401
    fresh = await login_as(client, "sita", temporary)
    assert fresh.json()["user"]["must_change_password"] is True
    row = await db.scalar(select(AuditLog).where(AuditLog.action == "reset_password"))
    assert row is not None and row.entity_id == str(sita.id)
    assert temporary not in str(row.data)


async def test_employee_can_link_to_one_user_only(client, make_user, login, db):
    await make_user("admin")
    branch = await _branch(db)
    employee = await _employee(db, branch)
    await login("admin")
    first = await _post(
        client,
        "/api/admin/users",
        {"full_name": "A", "phone": "9841000021", "role": "staff", "branch_id": branch.id,
         "employee_id": employee.id},
    )  # fmt: skip
    assert first.status_code == 201
    second = await _post(
        client,
        "/api/admin/users",
        {"full_name": "B", "phone": "9841000022", "role": "staff", "branch_id": branch.id,
         "employee_id": employee.id},
    )  # fmt: skip
    assert second.status_code == 409
    assert second.json()["detail"] == "That employee is already linked to another user."
    missing = await _post(
        client,
        "/api/admin/users",
        {"full_name": "C", "phone": "9841000023", "role": "staff", "branch_id": branch.id,
         "employee_id": 99999},
    )  # fmt: skip
    assert missing.status_code == 422
    users = (await db.execute(select(User).where(User.employee_id == employee.id))).scalars().all()
    assert len(users) == 1
