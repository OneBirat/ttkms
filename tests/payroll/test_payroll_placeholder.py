"""Payroll module tests live here (feat/payroll worktree)."""

import pytest

from app.contracts import FakeAttendanceSummary, get_attendance_summary
from app.modules.payroll import module

pytestmark = pytest.mark.anyio


async def test_payroll_placeholder(client, make_user, login):
    await make_user("manager", role="manager")
    await login("manager")
    response = await client.get("/api/payroll")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "payroll"


async def test_payroll_can_use_the_attendance_contract():
    summary = await get_attendance_summary().for_month(1, 2083, 7)
    assert isinstance(get_attendance_summary(), FakeAttendanceSummary)
    assert summary.paid_days <= summary.days_in_month
