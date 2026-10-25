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

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core import bsdate
from app.core.auth import CurrentUser
from app.core.errors import CodedErrorOut
from app.core.export import PDF_MEDIA_TYPE, XLSX_MEDIA_TYPE, PDFUnavailable
from app.core.models import User
from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ErrorOut, ModuleStatusOut
from app.db import DbSession
from app.modules.admin.permissions import require_access, require_any_access
from app.modules.payroll import exports, reports, services
from app.modules.payroll.schemas import (
    EmployeeCreatedOut,
    EmployeeIn,
    EmployeeListRowOut,
    EmployeeOut,
    EmployeeUpdateIn,
    NextCodeOut,
    SalaryReportOut,
    SalaryRevisionIn,
    SalaryStructuresOut,
)

EMPLOYEES = "manage_employees"
SALARY = "salary_advances"

router = APIRouter(dependencies=[Depends(require_any_access(EMPLOYEES, SALARY))])

CanManage = Annotated[User, Depends(require_access(EMPLOYEES))]
CanPay = Annotated[User, Depends(require_access(SALARY))]
ERRORS: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorOut},
    404: {"model": ErrorOut},
    409: {"model": CodedErrorOut},
    422: {"model": CodedErrorOut},
}


@router.get("", response_model=ModuleStatusOut, name="payroll:index")
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="payroll", title="People & payroll", status="ready")


# --------------------------------------------------------------------------- employees


@router.get("/employees", response_model=list[EmployeeListRowOut], name="payroll:employees")
async def list_employees(
    me: CanManage,
    db: DbSession,
    q: str | None = None,
    department_id: int | None = None,
    branch_id: int | None = None,
    active: bool | None = None,
) -> list[EmployeeListRowOut]:
    """Every employee the caller may see (own branch unless ``see_other_branches``), A-Z, with
    today's attendance mark; salary and balance due only with ``salary_advances``."""
    scope = await services.scope_for(db, me, branch_id)
    return await services.list_rows(db, scope, q=q, department_id=department_id, active=active)


@router.get("/employees/next-code", response_model=NextCodeOut, name="payroll:next_code")
async def next_code(me: CanManage, db: DbSession) -> NextCodeOut:
    code = await services.next_code(db)
    return NextCodeOut(code=code, barcode=services.barcode_of(code))


@router.get(
    "/employees/by-barcode/{barcode}",
    response_model=EmployeeOut,
    responses=ERRORS,
    name="payroll:employee_by_barcode",
)
async def employee_by_barcode(barcode: str, me: CurrentUser, db: DbSession) -> EmployeeOut:
    """``TTK-E001`` (the sticker) - ``TTK-E-001`` (stickers printed before 2026-10-26), ``E-001``
    and ``e1`` resolve too. Active employees only."""
    employee = await services.employee_by_barcode(db, barcode)
    scope = await services.scope_for(db, me, None)
    services.ensure_visible(scope, employee)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.get("/employees/{employee_id}", response_model=EmployeeOut, responses=ERRORS)
async def get_employee(employee_id: int, me: CanManage, db: DbSession) -> EmployeeOut:
    employee = await services.get_employee(db, employee_id)
    services.ensure_visible(await services.scope_for(db, me, None), employee)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.post(
    "/employees",
    response_model=EmployeeCreatedOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
)
async def create_employee(me: CanManage, db: DbSession, payload: EmployeeIn) -> EmployeeCreatedOut:
    """New employee with the salary in force from the joining date, optionally with a login
    (temporary password shown once; the person must change it at first sign-in)."""
    scope = await services.scope_for(db, me, None)
    if not scope.allows(payload.branch_id):
        raise services.invalid("You can only add employees to your own branch.", "branch_id")
    employee, login, temporary = await services.create_employee(db, me, payload)
    return EmployeeCreatedOut(
        employee=services.employee_out(employee, login), one_time_password=temporary
    )


@router.patch("/employees/{employee_id}", response_model=EmployeeOut, responses=ERRORS)
async def update_employee(
    employee_id: int, me: CanManage, db: DbSession, payload: EmployeeUpdateIn
) -> EmployeeOut:
    employee = await services.get_employee(db, employee_id)
    scope = await services.scope_for(db, me, None)
    services.ensure_visible(scope, employee)
    if not scope.allows(payload.branch_id):
        raise services.invalid("You can only move employees within your own branch.", "branch_id")
    employee = await services.update_employee(db, me, employee, payload)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.post("/employees/{employee_id}/deactivate", response_model=EmployeeOut, responses=ERRORS)
async def deactivate_employee(employee_id: int, me: CanManage, db: DbSession) -> EmployeeOut:
    """Former staff: kept with their history, out of lists and pickers, phone freed."""
    employee = await services.get_employee(db, employee_id)
    services.ensure_visible(await services.scope_for(db, me, None), employee)
    employee = await services.deactivate_employee(db, me, employee)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.get("/employees/{employee_id}/salary", response_model=SalaryStructuresOut, responses=ERRORS)
async def salary_structures(employee_id: int, me: CanManage, db: DbSession) -> SalaryStructuresOut:
    employee = await services.get_employee(db, employee_id)
    services.ensure_visible(await services.scope_for(db, me, None), employee)
    return await services.salary_structures(db, employee)


@router.post(
    "/employees/{employee_id}/salary",
    response_model=SalaryStructuresOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
)
async def revise_salary(
    employee_id: int, me: CanManage, db: DbSession, payload: SalaryRevisionIn
) -> SalaryStructuresOut:
    """A new salary row from ``effective_from_bs``; the overtime rate defaults to the
    salary / 30 / 8 rule (wage / 8 for daily staff) when not given."""
    employee = await services.get_employee(db, employee_id)
    services.ensure_visible(await services.scope_for(db, me, None), employee)
    await services.revise_salary(db, me, employee, payload)
    return await services.salary_structures(db, employee)


# ------------------------------------------------------------------------ salary report


def _file(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _pdf_or_503(render) -> bytes:
    try:
        return render()
    except PDFUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get(
    "/report/{month_key}.xlsx",
    responses=ERRORS,
    response_class=Response,
    name="payroll:report_xlsx",
)
async def salary_report_xlsx(
    month_key: str,
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
) -> Response:
    year, month = reports.parse_month_key(month_key)
    scope = await services.scope_for(db, me, branch_id)
    data = await reports.salary_report(db, scope, year, month, department_id)
    return _file(
        exports.salary_report_xlsx(data), XLSX_MEDIA_TYPE, f"{reports.report_file_stem(data)}.xlsx"
    )


@router.get(
    "/report/{month_key}.pdf",
    responses={**ERRORS, 503: {"model": ErrorOut}},
    response_class=Response,
    name="payroll:report_pdf",
)
async def salary_report_pdf(
    month_key: str,
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
) -> Response:
    year, month = reports.parse_month_key(month_key)
    scope = await services.scope_for(db, me, branch_id)
    data = await reports.salary_report(db, scope, year, month, department_id)
    pdf = _pdf_or_503(lambda: exports.salary_report_pdf(data, reports.printed_by(me)))
    return _file(pdf, PDF_MEDIA_TYPE, f"{reports.report_file_stem(data)}.pdf")


@router.get("/report/{month_key}", response_model=SalaryReportOut, responses=ERRORS)
async def salary_report(
    month_key: str,
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
) -> SalaryReportOut:
    """One BS month ("2083-07"): rows, totals, per department and per branch, the trend. Scoped
    to the caller's branch unless they hold ``see_other_branches``."""
    year, month = reports.parse_month_key(month_key)
    scope = await services.scope_for(db, me, branch_id)
    return (await reports.salary_report(db, scope, year, month, department_id)).out


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
