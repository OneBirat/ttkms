"""The ONE active branch: /api/auth/me returns it (and, for see_other_branches, every active branch
A-Z with its staff), PUT /api/me/active-branch switches it (audit-logged), it is kept across
logins, and everyone without see_other_branches is always on their own branch."""

from datetime import date

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, Department, Employee, EmployeeStatus, User
from app.modules.admin.models import UserAccess

pytestmark = pytest.mark.anyio

PATH = "/api/me/active-branch"


async def _branches(db):
    main, second, closed = (
        Branch(name="Main branch"),
        Branch(name="Branch 2"),
        Branch(name="Old shop", is_active=False),
    )
    store = Department(name="Store")
    db.add_all([main, second, closed, store])
    await db.flush()
    for name, branch, status in (
        ("Anita", main, EmployeeStatus.active),
        ("Bikash", main, EmployeeStatus.active),
        ("Hari", main, EmployeeStatus.inactive),
        ("Mina", second, EmployeeStatus.active),
    ):
        db.add(
            Employee(
                full_name=name,
                branch_id=branch.id,
                department_id=store.id,
                joined_ad=date(2026, 1, 1),
                status=status,
            )
        )
    await db.flush()
    return main, second, closed


async def _csrf(client) -> dict:
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def test_admin_switches_and_it_persists_across_logins(client, db, make_user, login):
    main, second, closed = await _branches(db)
    admin = await make_user("admin", role="admin", active_branch_id=None)
    db.add(UserAccess(user_id=admin.id, branch_id=main.id, access={}))
    await db.flush()
    body = (await login("admin")).json()
    assert body["active_branch"] == {"id": main.id, "name": "Main branch"}  # their own branch
    # The switcher's list: active branches A-Z with their active staff.
    assert body["branches"] == [
        {"id": second.id, "name": "Branch 2", "staff": 1},
        {"id": main.id, "name": "Main branch", "staff": 2},
    ]
    h = await _csrf(client)

    switched = await client.put(PATH, json={"branch_id": second.id}, headers=h)
    assert switched.status_code == 200, switched.text
    assert switched.json()["active_branch"] == {"id": second.id, "name": "Branch 2"}
    assert switched.json()["branch_id"] == main.id  # their own branch does not change
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == second.id

    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "active_branch"))
    assert audit.user_id == admin.id
    assert audit.data == {"before": {"branch_id": main.id}, "after": {"branch_id": second.id}}

    # Unknown or inactive branches: 422.
    for bad in (closed.id, 99999):
        assert (await client.put(PATH, json={"branch_id": bad}, headers=h)).status_code == 422

    await client.post("/api/auth/logout", headers=h)
    again = (await login("admin")).json()
    assert again["active_branch"] == {"id": second.id, "name": "Branch 2"}


async def test_fallback_when_nothing_saved_or_the_saved_branch_is_closed(
    client, db, make_user, login
):
    main, second, closed = await _branches(db)
    await make_user("boss", role="admin", active_branch_id=None)  # no own branch, nothing saved
    body = (await login("boss")).json()
    assert body["active_branch"] == {"id": second.id, "name": "Branch 2"}  # first active A-Z

    # A saved branch that is deactivated later: their own branch if active, else first active A-Z.
    boss = await db.scalar(select(User).where(User.username == "boss"))
    boss.active_branch_id = main.id
    await db.flush()
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == main.id
    main.is_active = False
    await db.flush()
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == second.id
    db.add(UserAccess(user_id=boss.id, branch_id=closed.id, access={}))
    await db.flush()
    # Their own branch is closed too: still the first active branch.
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == second.id


async def test_staff_stay_on_their_own_branch(client, db, make_user, login):
    main, second, closed = await _branches(db)
    clerk = await make_user("clerk", role="staff", active_branch_id=second.id)
    db.add(UserAccess(user_id=clerk.id, branch_id=main.id, access={}))
    await db.flush()
    body = (await login("clerk")).json()
    # Whatever is stored, their own branch wins; no switcher list.
    assert body["active_branch"] == {"id": main.id, "name": "Main branch"}
    assert body["branches"] is None
    h = await _csrf(client)
    assert (await client.put(PATH, json={"branch_id": second.id}, headers=h)).status_code == 403
    own = await client.put(PATH, json={"branch_id": main.id}, headers=h)
    assert own.status_code == 200 and own.json()["active_branch"]["id"] == main.id


async def test_switching_needs_a_session(client):
    h = await _csrf(client)
    assert (await client.put(PATH, json={"branch_id": 1}, headers=h)).status_code == 401
