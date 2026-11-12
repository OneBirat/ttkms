"""The super admin (``core.users.is_super_admin``): one account at most, set only from the
command line, holds every permission, and no other admin can edit, disable or reset it."""

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app import cli
from app.core.auth import verify_password
from app.core.models import AuditLog, Branch, User
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import PERMISSIONS, access_for_user
from app.modules.admin.services import SUPER_ADMIN_PROTECTED

pytestmark = pytest.mark.anyio


async def _csrf(client) -> dict[str, str]:
    return {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}


async def _post(client, path, json=None):
    return await client.post(path, json=json, headers=await _csrf(client))


async def _put(client, path, json):
    return await client.put(path, json=json, headers=await _csrf(client))


def _body(user: User, **changes) -> dict:
    return {
        "full_name": user.full_name,
        "phone": "9841000077",
        "role": user.role.value,
        "branch_id": None,
        "employee_id": None,
        "access": None,
    } | changes


async def _super(db, make_user, username="owner") -> User:
    user = await make_user(username, full_name="The Owner")
    user.is_super_admin = True
    await db.flush()
    return user


# ---------------------------------------------------------------------------- the flag


async def test_a_second_super_admin_cannot_be_set(db, make_user):
    await _super(db, make_user)
    other = await make_user("second")
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            await db.execute(update(User).where(User.id == other.id).values(is_super_admin=True))
    holders = (await db.scalars(select(User.username).where(User.is_super_admin))).all()
    assert holders == ["owner"]


async def test_cli_sets_and_moves_the_flag(db, make_user):
    first, second = await make_user("first"), await make_user("second")
    asked: list[str] = []

    def yes(question: str) -> bool:
        asked.append(question)
        return True

    user, previous = await cli.set_super_admin(db, " First ", confirm=yes)
    assert user.id == first.id and previous is None and first.is_super_admin
    assert "'first'" in asked[0] and "take it away" not in asked[0]

    user, previous = await cli.set_super_admin(db, "second", confirm=yes)
    assert user.id == second.id and previous.id == first.id
    assert second.is_super_admin and not first.is_super_admin
    assert "take it away from 'first'" in asked[1]

    audit = (
        await db.scalars(select(AuditLog).where(AuditLog.action == "cli_set_super_admin"))
    ).all()
    assert [a.data["previous"] for a in audit] == [None, "first"]
    assert all(a.user_id is None and a.module == "core" for a in audit)


async def test_cli_refusals_change_nothing(db, make_user):
    owner = await _super(db, make_user)
    await make_user("clerk", role="staff")
    await make_user("gone", is_active=False)
    await make_user("other")
    for login, words in [
        ("nobody", "no user"),
        ("clerk", "not an Admin"),
        ("gone", "disabled"),
        ("owner", "already the super admin"),
    ]:
        with pytest.raises(cli.CliError, match=words):
            await cli.set_super_admin(db, login, confirm=lambda q: True)
    with pytest.raises(cli.CliError, match="cancelled"):
        await cli.set_super_admin(db, "other", confirm=lambda q: False)
    await db.refresh(owner)
    assert owner.is_super_admin
    assert (await db.scalars(select(User.username).where(User.is_super_admin))).all() == ["owner"]


async def test_cli_finds_a_user_by_phone(db, make_user):
    user = await make_user("sita")
    user.phone = "9841000009"
    await db.flush()
    found, _ = await cli.set_super_admin(db, "+977 98410-00009", confirm=lambda q: True)
    assert found.id == user.id


def test_cli_parser_has_the_command():
    args = cli.build_parser().parse_args(["set-super-admin", "owner", "--yes"])
    assert args.username == "owner" and args.yes is True and args.func is cli.cmd_set_super_admin


# -------------------------------------------------------------------------- what it holds


async def test_super_admin_holds_every_permission_whatever_the_switches(db, make_user):
    owner = await _super(db, make_user)
    db.add(UserAccess(user_id=owner.id, access=dict.fromkeys(PERMISSIONS, False)))
    await db.flush()
    assert await access_for_user(db, owner) == dict.fromkeys(PERMISSIONS, True)


async def test_session_and_users_list_show_the_flag(client, db, make_user, login):
    owner = await _super(db, make_user)
    await make_user("admin2")
    await login("owner")
    me = (await client.get("/api/auth/me")).json()
    assert me["user"]["is_super_admin"] is True
    users = {u["username"]: u for u in (await client.get("/api/admin/users")).json()}
    assert users["owner"]["is_super_admin"] is True and users["owner"]["id"] == owner.id
    assert users["admin2"]["is_super_admin"] is False

    await login("admin2")
    assert (await client.get("/api/auth/me")).json()["user"]["is_super_admin"] is False
    users = {u["username"]: u for u in (await client.get("/api/admin/users")).json()}
    assert users["owner"]["is_super_admin"] is True and users["owner"]["is_you"] is False


# ------------------------------------------------------------------------ the protection


async def test_an_admin_cannot_edit_disable_or_reset_the_super_admin(client, db, make_user, login):
    owner = await _super(db, make_user)
    await make_user("admin2")
    old_hash = owner.password_hash
    await login("admin2")

    for response in [
        await _put(client, f"/api/admin/users/{owner.id}", _body(owner, full_name="Hacked")),
        await _put(client, f"/api/admin/users/{owner.id}", _body(owner, role="staff", branch_id=1)),
        await _put(
            client,
            f"/api/admin/users/{owner.id}",
            _body(owner, access=dict.fromkeys(PERMISSIONS, False)),
        ),
        await _post(client, f"/api/admin/users/{owner.id}/active", {"is_active": False}),
        await _post(client, f"/api/admin/users/{owner.id}/reset-password"),
    ]:
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == SUPER_ADMIN_PROTECTED

    await db.refresh(owner)
    assert owner.full_name == "The Owner" and owner.role.value == "admin" and owner.is_active
    assert owner.password_hash == old_hash and not owner.must_change_password
    assert owner.is_super_admin
    assert await db.get(UserAccess, owner.id) is None
    assert verify_password(owner.password_hash, "secret123")


async def test_the_api_cannot_set_the_flag(client, db, make_user, login):
    await make_user("admin")
    other = await make_user("other")
    main = Branch(name="Main branch")
    db.add(main)
    await db.flush()
    await login("admin")
    response = await _put(
        client, f"/api/admin/users/{other.id}", _body(other) | {"is_super_admin": True}
    )
    assert response.status_code == 200 and response.json()["is_super_admin"] is False
    created = await _post(
        client,
        "/api/admin/users",
        _body(other, phone="9841000078", full_name="New One") | {"is_super_admin": True},
    )
    assert created.status_code == 201 and created.json()["user"]["is_super_admin"] is False
    assert (await db.scalars(select(User).where(User.is_super_admin))).all() == []


async def test_the_super_admin_edits_their_own_account(client, db, make_user, login):
    owner = await _super(db, make_user)
    await make_user("admin2")
    await login("owner")
    response = await _put(
        client, f"/api/admin/users/{owner.id}", _body(owner, full_name="Owner Renamed")
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] == "Owner Renamed" and body["is_super_admin"] is True
    # ... but, like every admin, cannot disable or demote themselves.
    assert (
        await _post(client, f"/api/admin/users/{owner.id}/active", {"is_active": False})
    ).status_code == 409
    assert (
        await _put(client, f"/api/admin/users/{owner.id}", _body(owner, role="staff", branch_id=1))
    ).status_code == 409
    # Their own password goes through the normal change-password call.
    changed = await _post(
        client,
        "/api/auth/change-password",
        {"current_password": "secret123", "new_password": "a-new-password-9"},
    )
    assert changed.status_code == 200, changed.text
