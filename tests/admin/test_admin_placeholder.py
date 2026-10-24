"""Admin module tests live here (feat/admin worktree)."""

import pytest

from app.modules.admin import module

pytestmark = pytest.mark.anyio


async def test_admin_placeholder(client, make_user, login):
    await make_user("admin")
    await login("admin")
    response = await client.get("/api/admin")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "admin"


async def test_admin_is_admin_only(client, make_user, login):
    await make_user("manager", role="manager")
    await login("manager")
    assert (await client.get("/api/admin")).status_code == 403


async def test_admin_nav_for_admin(client, make_user, login):
    await make_user("admin")
    await login("admin")
    registry = (await client.get("/api/registry")).json()
    admin = next(m for m in registry["modules"] if m["name"] == "admin")
    assert [item["path"] for item in admin["nav"]] == [
        "/admin/users",
        "/admin/org",
        "/admin/settings",
        "/admin/audit",
    ]
    assert admin["allowed"] is True


@pytest.mark.parametrize(
    ("role", "paths"),
    [
        ("manager", ["/admin/org"]),
        ("staff", []),
    ],
)
async def test_admin_nav_for_other_roles(client, make_user, login, role, paths):
    await make_user(role, role=role)
    await login(role)
    registry = (await client.get("/api/registry")).json()
    admin = next(m for m in registry["modules"] if m["name"] == "admin")
    assert [item["path"] for item in admin["nav"]] == paths
    assert admin["allowed"] is bool(paths)
