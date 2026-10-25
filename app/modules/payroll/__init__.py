"""People & payroll module (sidebar section "People & payroll").

The feat/payroll worktree builds this module and only touches app/modules/payroll/,
migrations/payroll/, tests/payroll/ and its pages under web/app/people/. Put models in
app/modules/payroll/models.py (schema "payroll"), API routes on the router below (mounted at
/api/payroll), and register dashboard widgets on the Module.

Access is per user (app.modules.admin.permissions): ``manage_employees`` opens Employees
(Manager and Admin presets), ``salary_advances`` opens Salary report and Payment reports (Admin
preset, or switched on for a user). Guard real endpoints with ``require_access(<permission>)``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.core import bsdate
from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ModuleStatusOut
from app.modules.admin.permissions import require_any_access

EMPLOYEES = "manage_employees"
SALARY = "salary_advances"

router = APIRouter(dependencies=[Depends(require_any_access(EMPLOYEES, SALARY))])


@router.get("", response_model=ModuleStatusOut, name="payroll:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="payroll", title="People & payroll", status="coming_soon")


# --------------------------------------------------------------------------- widgets

#: Sample payments for the "Payments today" card until ``payroll.payments`` exists: three
#: payments, Rs 12,500 in total (one salary, two advances). Amounts in rupees; ``mode`` is the
#: payment mode's name (``GET /api/admin/payment-modes``); ``time`` is Kathmandu wall-clock.
SAMPLE_PAYMENTS_TODAY: list[dict[str, Any]] = [
    {"payment_id": 1041, "employee_id": 4, "name": "Bimala Rai", "type": "salary",
     "amount": 8000, "mode": "Cash", "time": "10:20"},
    {"payment_id": 1042, "employee_id": 9, "name": "Hari Shrestha", "type": "advance",
     "amount": 3000, "mode": "Cash", "time": "11:05"},
    {"payment_id": 1043, "employee_id": 13, "name": "Sita Thapa", "type": "advance",
     "amount": 1500, "mode": "eSewa", "time": "13:40"},
]  # fmt: skip


def payments_today_data(payments: list[dict[str, Any]]) -> dict[str, Any]:
    """``PaymentsTodayWidgetData``: today's date (both calendars), the count and totals (all /
    salary / advance, rupees), the payments newest first, and the register link."""
    header = bsdate.header_date()
    return {
        "date": header.ad_date.isoformat(),
        "date_bs": header.bs_date.isoformat(),
        "count": len(payments),
        "total": sum(p["amount"] for p in payments),
        "salary_total": sum(p["amount"] for p in payments if p["type"] == "salary"),
        "advance_total": sum(p["amount"] for p in payments if p["type"] == "advance"),
        "payments": sorted(payments, key=lambda p: p["time"], reverse=True),
        "payments_path": "/people/payments",
    }


async def payments_today_widget(ctx: WidgetContext) -> dict[str, Any]:
    """The "Payments today" card (web/app/people/_components/widgets). Sample data until the
    payroll backend exists; the real version lists today's payments of the caller's branch(es)."""
    return {
        "kind": "payments_today",
        "title": "Payments today",
        "data": payments_today_data(SAMPLE_PAYMENTS_TODAY),
    }


async def payroll_today_counts(ctx: WidgetContext) -> dict[str, Any]:
    """Payroll's share of ``GET /api/today`` ``counts`` (``TodayCountsOut``): rupees paid today
    and the number of payments."""
    data = payments_today_data(SAMPLE_PAYMENTS_TODAY)
    return {"paid_today": data["total"], "payments_today": data["count"]}


module = Module(
    name="payroll",
    title="People & payroll",
    router=router,
    nav=[
        NavItem(label="Employees", path="/people/employees", icon="users", permission=EMPLOYEES),
        NavItem(label="Salary report", path="/people/salary", icon="banknote", permission=SALARY),
        NavItem(label="Payment reports", path="/people/payments", icon="list", permission=SALARY),
    ],
    dashboard_widgets=[payments_today_widget],
    today_counts=payroll_today_counts,
)
