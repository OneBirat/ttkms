"""Payroll module tests live here (feat/payroll worktree)."""

import pytest

from app.contracts import FakeAttendanceSummary, get_attendance_summary
from app.modules.payroll import SAMPLE_PAYMENTS_TODAY, module

pytestmark = pytest.mark.anyio


async def test_payroll_placeholder(client, make_user, login):
    await make_user("manager", role="manager")
    await login("manager")
    response = await client.get("/api/payroll")
    assert response.status_code == 200
    assert response.json()["status"] == "coming_soon"
    assert module.name == "payroll"


async def test_dashboard_widget_is_payments_today(client, make_user, login):
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
    assert data["count"] == len(SAMPLE_PAYMENTS_TODAY)
    assert {p["type"] for p in data["payments"]} <= {"salary", "advance"}
    assert all(
        {"payment_id", "employee_id", "name", "amount", "mode", "time"} <= set(p)
        for p in data["payments"]
    )


async def test_payroll_can_use_the_attendance_contract():
    summary = await get_attendance_summary().for_month(1, 2083, 7)
    assert isinstance(get_attendance_summary(), FakeAttendanceSummary)
    assert summary.paid_days <= summary.days_in_month
