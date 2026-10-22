"""Attendance module tests live here (feat/attendance worktree)."""

import pytest

from app.modules.attendance import module

pytestmark = pytest.mark.anyio


async def test_attendance_placeholder(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    response = await client.get("/attendance")
    assert response.status_code == 200
    assert "Coming soon" in response.text
    assert module.name == "attendance"
