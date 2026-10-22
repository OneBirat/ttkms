"""Stock module tests live here (feat/stock worktree). Only the placeholder is covered for now."""

import pytest

from app.modules.stock import module

pytestmark = pytest.mark.anyio


async def test_stock_placeholder(client, make_user, login):
    await make_user("keeper", role="store_keeper")
    await login("keeper")
    response = await client.get("/api/stock")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "stock"
