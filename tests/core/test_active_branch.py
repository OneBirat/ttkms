"""The ONE active branch: /api/auth/me returns it, PATCH /api/auth/me/active-branch switches it
(see_other_branches only, audit-logged), it is kept across logins, and everyone without the
switch is always on their own branch."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog, Branch, User
from app.modules.admin.models import UserAccess

pytestmark = pytest.mark.anyio


async def _branches(db):
    main, second, closed = (
        Branch(name="Main branch"),
        Branch(name="Branch 2"),
        Branch(name="Old shop", is_active=False),
    )
    db.add_all([main, second, closed])
    await db.flush()
    return main, second, closed


async def _csrf(client) -> dict:
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def test_admin_switches_and_it_persists_across_logins(client, db, make_user, login):
    main, second, closed = await _branches(db)
    admin = await make_user("admin", role="admin")
    db.add(UserAccess(user_id=admin.id, branch_id=main.id, access={}))
    await db.flush()
    body = (await login("admin")).json()
    assert body["active_branch"] == {"id": main.id, "name": "Main branch"}
    h = await _csrf(client)

    switched = await client.patch(
        "/api/auth/me/active-branch", json={"branch_id": second.id}, headers=h
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["active_branch"] == {"id": second.id, "name": "Branch 2"}
    assert switched.json()["branch_id"] == main.id  # their own branch does not change
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == second.id

    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "active_branch"))
    assert audit.user_id == admin.id
    assert audit.data == {"before": {"branch_id": main.id}, "after": {"branch_id": second.id}}

    # Unknown or closed branches are refused.
    for bad in (closed.id, 99999):
        refused = await client.patch(
            "/api/auth/me/active-branch", json={"branch_id": bad}, headers=h
        )
        assert refused.status_code == 422

    await client.post("/api/auth/logout", headers=h)
    again = (await login("admin")).json()
    assert again["active_branch"] == {"id": second.id, "name": "Branch 2"}


async def test_without_a_pick_admins_start_on_their_own_or_the_first_branch(
    client, db, make_user, login
):
    main, second, closed = await _branches(db)
    await make_user("boss", role="admin")  # no user_access row, nothing stored
    body = (await login("boss")).json()
    assert body["active_branch"] == {"id": second.id, "name": "Branch 2"}  # first active A-Z
    # A stored branch that was closed later falls back too.
    boss = await db.scalar(select(User).where(User.username == "boss"))
    boss.active_branch_id = closed.id
    await db.flush()
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == second.id


async def test_staff_cannot_switch_and_stay_on_their_own_branch(client, db, make_user, login):
    main, second, closed = await _branches(db)
    clerk = await make_user("clerk", role="staff")
    clerk.active_branch_id = second.id  # whatever is stored, their own branch wins
    db.add(UserAccess(user_id=clerk.id, branch_id=main.id, access={}))
    await db.flush()
    body = (await login("clerk")).json()
    assert body["active_branch"] == {"id": main.id, "name": "Main branch"}
    h = await _csrf(client)
    refused = await client.patch(
        "/api/auth/me/active-branch", json={"branch_id": second.id}, headers=h
    )
    assert refused.status_code == 403
    assert (await client.get("/api/auth/me")).json()["active_branch"]["id"] == main.id
    assert await db.scalar(select(AuditLog).where(AuditLog.action == "active_branch")) is None


async def test_switching_needs_a_session(client):
    h = await _csrf(client)
    response = await client.patch("/api/auth/me/active-branch", json={"branch_id": 1}, headers=h)
    assert response.status_code == 401
