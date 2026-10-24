"""Stock module tests live here (feat/stock worktree). Only the placeholder is covered for now.

The module is paused (not in the default ENABLED_MODULES), so these tests build their own app
with stock switched on through the ``client_for`` fixture.
"""

import pytest

from tests.conftest import login_as

pytestmark = pytest.mark.anyio

WITH_STOCK = "stock,attendance,payroll,admin"


async def test_stock_placeholder(client_for, make_user):
    from app.modules.stock import module

    await make_user("keeper", role="manager")
    async with client_for(WITH_STOCK) as client:
        await login_as(client, "keeper")
        response = await client.get("/api/stock")
        assert response.status_code == 200
        assert response.json()["status"] == "coming_soon"
    assert module.name == "stock"
