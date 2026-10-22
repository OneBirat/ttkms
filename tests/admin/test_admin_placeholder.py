"""Admin module tests live here (feat/admin worktree)."""

import pytest

from app.modules.admin import module

pytestmark = pytest.mark.anyio


async def test_admin_placeholder(client, make_user, login):
    await make_user("admin")
    await login("admin")
    response = await client.get("/admin")
    assert response.status_code == 200
    assert "Coming soon" in response.text
    assert module.name == "admin"


async def test_admin_is_admin_only(client, make_user, login):
    await make_user("manager", role="manager")
    await login("manager")
    assert (await client.get("/admin")).status_code == 403
