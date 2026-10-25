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
    assert response.json()["status"] == "ready"
    assert module.name == "payroll"


async def test_dashboard_widget_is_payments_today(client, make_user, login):
    """Empty database: the card is there with zeros (real rows are covered in
    test_contract_and_dashboard.py)."""
    await make_user("admin")
    await login("admin")
    widgets = [
        w
        for w in (await client.get("/api/dashboard")).json()["widgets"]
        if w["module"] == "payroll"
    ]
    assert [w["kind"] for w in widgets] == ["payments_today"]
    data = widgets[0]["data"]
    assert set(data) == {
        "date", "date_bs", "count", "total", "salary_total", "advance_total", "payments",
        "payments_path",
    }  # fmt: skip
    assert (
        data["count"] == 0
        and data["payments"] == []
        and data["payments_path"] == "/people/payments"
    )


async def test_payroll_can_use_the_attendance_contract():
    summary = await get_attendance_summary().for_month(1, 2083, 7)
    assert isinstance(get_attendance_summary(), FakeAttendanceSummary)
    assert summary.paid_days <= summary.days_in_month
