"""Admin module registration: index, sidebar entries per role."""

import pytest

from app.modules.admin import module

pytestmark = pytest.mark.anyio


async def test_index_is_admin_only(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    assert (await client.get("/api/admin")).status_code == 403
    await make_user("admin")
    await login("admin")
    response = await client.get("/api/admin")
    assert response.status_code == 200
    assert response.json() == {"module": "admin", "title": "Admin", "status": "ready"}
    assert module.name == "admin"


async def test_index_requires_login(client):
    assert (await client.get("/api/admin")).status_code == 401


async def test_admin_nav_for_admin(client, make_user, login):
    await make_user("admin")
    await login("admin")
    registry = (await client.get("/api/registry")).json()
    admin = next(m for m in registry["modules"] if m["name"] == "admin")
    assert [item["path"] for item in admin["nav"]][0] == "/admin/users"
    assert admin["allowed"] is True


@pytest.mark.parametrize("role", ["manager", "staff"])
async def test_admin_nav_hidden_for_other_roles(client, make_user, login, role):
    await make_user(role, role=role)
    await login(role)
    registry = (await client.get("/api/registry")).json()
    admin = next(m for m in registry["modules"] if m["name"] == "admin")
    assert admin["nav"] == [] and admin["allowed"] is False
