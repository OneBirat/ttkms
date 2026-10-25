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

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core import bsdate
from app.core.auth import CurrentUser, require_role
from app.core.bsdate import BSDate
from app.core.errors import CodedErrorOut
from app.core.export import PDF_MEDIA_TYPE, XLSX_MEDIA_TYPE, PDFUnavailable
from app.core.models import Employee, User
from app.core.modules import Module, NavItem, WidgetContext
from app.core.schemas import ErrorOut, ModuleStatusOut
from app.db import DbSession
from app.modules.admin.permissions import require_access, require_any_access
from app.modules.payroll import contract, exports, payments, photos, reports, services
from app.modules.payroll.models import Payment
from app.modules.payroll.schemas import (
    AccountSummaryOut,
    BsMonthOut,
    EmployeeCreatedOut,
    EmployeeIn,
    EmployeeLedgerOut,
    EmployeeListRowOut,
    EmployeeMonthAttendanceOut,
    EmployeeOut,
    EmployeeUpdateIn,
    MonthBalanceOut,
    MonthLedgerOut,
    NextCodeOut,
    PaymentIn,
    PaymentOut,
    PaymentResultOut,
    PaymentsRegisterOut,
    PhotoTokenIn,
    PhotoTokenInfoOut,
    PhotoTokenOut,
    RegisterSort,
    SalaryReportOut,
    SalaryRevisionIn,
    SalaryStructuresOut,
    VoidPaymentIn,
)

EMPLOYEES = "manage_employees"
SALARY = "salary_advances"

# Every route names its own guard (CanManage / CanPay / AnyAccess, CurrentUser for the barcode
# lookup); the phone photo-token routes are public by design.
router = APIRouter()

CanManage = Annotated[User, Depends(require_access(EMPLOYEES))]
CanPay = Annotated[User, Depends(require_access(SALARY))]
AdminOnly = Annotated[User, Depends(require_role("admin"))]
AnyAccess = Annotated[User, Depends(require_any_access(EMPLOYEES, SALARY))]
ERRORS: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorOut},
    404: {"model": ErrorOut},
    409: {"model": CodedErrorOut},
    422: {"model": CodedErrorOut},
}


@router.get("", response_model=ModuleStatusOut, name="payroll:index")
async def index(me: AnyAccess) -> ModuleStatusOut:
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


# ------------------------------------------------------------------------------ account


async def _visible(db, me: User, employee_id: int):
    employee = await services.get_employee(db, employee_id)
    services.ensure_visible(await services.scope_for(db, me, None), employee)
    return employee


@router.get("/months", response_model=list[BsMonthOut], name="payroll:months")
async def months(me: AnyAccess, db: DbSession) -> list[BsMonthOut]:
    """Months the report select offers, newest first."""
    return await payments.months_with_data(db)


@router.get(
    "/employees/{employee_id}/attendance",
    response_model=EmployeeMonthAttendanceOut,
    responses=ERRORS,
)
async def employee_attendance(
    employee_id: int, me: AnyAccess, db: DbSession, bs_year: int, bs_month: int
) -> EmployeeMonthAttendanceOut:
    employee = await _visible(db, me, employee_id)
    return await payments.attendance_month(employee, bs_year, bs_month)


@router.get(
    "/employees/{employee_id}/ledger", response_model=list[MonthLedgerOut], responses=ERRORS
)
async def employee_ledger(employee_id: int, me: CanPay, db: DbSession) -> list[MonthLedgerOut]:
    """Newest month first, from the joining month, within the kept window."""
    return await payments.month_ledgers(db, await _visible(db, me, employee_id))


@router.get(
    "/employees/{employee_id}/ledger/{month_key}", response_model=MonthLedgerOut, responses=ERRORS
)
async def employee_month_ledger(
    employee_id: int, month_key: str, me: CanPay, db: DbSession
) -> MonthLedgerOut:
    year, month = reports.parse_month_key(month_key)
    return await payments.month_ledger(db, await _visible(db, me, employee_id), year, month)


@router.get(
    "/employees/{employee_id}/transactions", response_model=EmployeeLedgerOut, responses=ERRORS
)
async def employee_transactions(employee_id: int, me: CanPay, db: DbSession) -> EmployeeLedgerOut:
    """The running ledger, oldest first: salary earned, absence, overtime, payments out."""
    return await payments.transactions(db, await _visible(db, me, employee_id))


@router.get("/employees/{employee_id}/summary", response_model=AccountSummaryOut, responses=ERRORS)
async def employee_summary(employee_id: int, me: CanPay, db: DbSession) -> AccountSummaryOut:
    """What the Give advance / Pay salary dialogs show."""
    return await payments.account_summary(db, await _visible(db, me, employee_id))


@router.get(
    "/employees/{employee_id}/payslips/{month_key}.pdf",
    responses={**ERRORS, 503: {"model": ErrorOut}},
    response_class=Response,
    name="payroll:payslip_pdf",
)
async def payslip_pdf(employee_id: int, month_key: str, me: CanPay, db: DbSession) -> Response:
    employee = await _visible(db, me, employee_id)
    year, month = reports.parse_month_key(month_key)
    ledger = await payments.month_ledger(db, employee, year, month)
    pdf = _pdf_or_503(lambda: exports.payslip_pdf(employee, ledger, reports.printed_by(me)))
    return _file(pdf, PDF_MEDIA_TYPE, f"payslip-{employee.code}-{month_key}.pdf")


# ----------------------------------------------------------------------------- payments


@router.get("/balance", response_model=MonthBalanceOut, responses=ERRORS, name="payroll:balance")
async def balance(
    me: CanPay, db: DbSession, employee_id: int, for_year: int, for_month: int
) -> MonthBalanceOut:
    """The contract's MonthBalance for one BS month (earned so far, paid, due)."""
    employee = await _visible(db, me, employee_id)
    return await payments.balance(db, employee, for_year, for_month)


@router.post(
    "/payments",
    response_model=PaymentResultOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
    name="payroll:record_payment",
)
async def record_payment(me: CanPay, db: DbSession, payload: PaymentIn) -> PaymentResultOut:
    """Record a salary or advance payment for ``for_year`` / ``for_month``. Advances: the running
    month, up to earned so far − paid. Salary: the running month (same cap) or a past month
    (up to its balance due). The mode must be active and allowed for the kind."""
    employee = await _visible(db, me, payload.employee_id)
    return await payments.record_payment(db, me, employee, payload)


@router.get("/payments/recent", response_model=list[PaymentOut], responses=ERRORS)
async def recent_payments(me: CanPay, db: DbSession, employee_id: int) -> list[PaymentOut]:
    """Newest first, for the advance dialog."""
    return await payments.recent_payments(db, await _visible(db, me, employee_id))


async def _register(
    db, me, branch_id, from_, to, type_, employee_id, department_id, sort, show_voided=False
):
    scope = await services.scope_for(db, me, branch_id)
    from_bs = BSDate.parse(from_) if from_ else None
    to_bs = BSDate.parse(to) if to else None
    return await payments.register(
        db,
        scope,
        from_bs=from_bs,
        to_bs=to_bs,
        kind=None if type_ in (None, "all") else type_,
        employee_id=employee_id,
        department_id=department_id,
        sort=sort,
        show_voided=show_voided,
    )


@router.get(
    "/payments/export.xlsx", responses=ERRORS, response_class=Response, name="payroll:register_xlsx"
)
async def register_xlsx(
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
    type: str | None = None,
    sort: RegisterSort = "date",
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
) -> Response:
    data = await _register(db, me, branch_id, from_, to, type, employee_id, department_id, sort)
    return _file(
        exports.register_xlsx(data), XLSX_MEDIA_TYPE, exports.register_file_name(data, "xlsx")
    )


@router.get(
    "/payments/export.pdf",
    responses={**ERRORS, 503: {"model": ErrorOut}},
    response_class=Response,
    name="payroll:register_pdf",
)
async def register_pdf(
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
    type: str | None = None,
    sort: RegisterSort = "date",
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
) -> Response:
    data = await _register(db, me, branch_id, from_, to, type, employee_id, department_id, sort)
    pdf = _pdf_or_503(lambda: exports.register_pdf(data, reports.printed_by(me)))
    return _file(pdf, PDF_MEDIA_TYPE, exports.register_file_name(data, "pdf"))


@router.get(
    "/payments/{payment_id}/receipt.pdf",
    responses={**ERRORS, 503: {"model": ErrorOut}},
    response_class=Response,
    name="payroll:receipt_pdf",
)
async def receipt_pdf(payment_id: int, me: CanPay, db: DbSession) -> Response:
    payment = await payments.get_payment(db, payment_id)
    employee = await _visible(db, me, payment.employee_id)
    out = reports.payment_out(payment, await services.modes_by_id(db))
    pdf = _pdf_or_503(lambda: exports.receipt_pdf(employee, out, reports.printed_by(me)))
    return _file(pdf, PDF_MEDIA_TYPE, f"receipt-{payment.receipt_no}.pdf")


@router.get(
    "/payments", response_model=PaymentsRegisterOut, responses=ERRORS, name="payroll:register"
)
async def register(
    me: CanPay,
    db: DbSession,
    branch_id: int | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
    type: str | None = None,
    sort: RegisterSort = "date",
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    show_voided: bool = False,
) -> PaymentsRegisterOut:
    """Payments in a BS date range (``from`` / ``to``, inclusive), scoped to the caller's branch
    unless they hold ``see_other_branches``; ``sort`` = date (newest first) | branch |
    department | employee | amount. Group headings and subtotals are the client's: with all
    branches and ``sort=department`` the rows come branch → department → newest first.
    ``show_voided=1`` also lists voided payments (struck through; never in a total); the
    exports never include them."""
    return await _register(
        db, me, branch_id, from_, to, type, employee_id, department_id, sort, show_voided
    )


@router.post(
    "/payments/{payment_id}/void",
    response_model=PaymentOut,
    responses={**ERRORS, 409: {"model": CodedErrorOut}},
    name="payroll:void_payment",
)
async def void_payment(
    payment_id: int, me: AdminOnly, db: DbSession, payload: VoidPaymentIn
) -> PaymentOut:
    """Admins only, with a reason; cannot be undone. The payment stays listed (struck through)
    and keeps its receipt number but counts for nothing: not paid, not due, not in any total,
    export or payments-per-month figure."""
    payment = await payments.get_payment(db, payment_id)
    return await payments.void_payment(db, me, payment, payload.reason)


# ------------------------------------------------------------------------------- photos


async def _photo_bytes(request: Request) -> bytes:
    """Multipart ``image`` (or ``photo_data_url`` form field) or JSON ``{photo_data_url}``."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("image")
        if upload is not None and hasattr(upload, "read"):
            raw = await upload.read()
            if len(raw) > photos.MAX_BYTES:
                raise photos.invalid("The photo is larger than 5 MB.")
            return raw
        data_url = form.get("photo_data_url")
        if isinstance(data_url, str):
            return photos.decode_data_url(data_url)
        raise photos.invalid("Send the photo as the 'image' file or as photo_data_url.")
    body = await request.json()
    data_url = body.get("photo_data_url") if isinstance(body, dict) else None
    if not isinstance(data_url, str):
        raise photos.invalid("Send the photo as photo_data_url.", "photo_data_url")
    return photos.decode_data_url(data_url)


@router.get(
    "/employees/{employee_id}/photo",
    responses={404: {"model": ErrorOut}},
    response_class=Response,
    name="payroll:employee_photo",
)
async def employee_photo(employee_id: int, me: AnyAccess, db: DbSession) -> Response:
    """The stored JPEG (600 px), for signed-in users who may see the employee."""
    employee = await _visible(db, me, employee_id)
    return FileResponse(photos.photo_path_or_404(employee), media_type="image/jpeg")


@router.put("/employees/{employee_id}/photo", response_model=EmployeeOut, responses=ERRORS)
async def set_employee_photo(
    employee_id: int, me: CanManage, db: DbSession, request: Request
) -> EmployeeOut:
    """Replace the photo: multipart ``image`` (JPEG / PNG / WebP, 5 MB at most) or a data URL;
    stored as a 600 px JPEG under the media directory."""
    employee = await _visible(db, me, employee_id)
    raw = await _photo_bytes(request)
    employee = await photos.store_photo(db, me, employee, raw)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.delete("/employees/{employee_id}/photo", response_model=EmployeeOut, responses=ERRORS)
async def remove_employee_photo(employee_id: int, me: CanManage, db: DbSession) -> EmployeeOut:
    employee = await _visible(db, me, employee_id)
    employee = await photos.remove_photo(db, me, employee)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


@router.post(
    "/photo-tokens",
    response_model=PhotoTokenOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
    name="payroll:create_photo_token",
)
async def create_photo_token(
    me: CanManage, db: DbSession, payload: PhotoTokenIn, request: Request
) -> PhotoTokenOut:
    """A single-use link (15 minutes) the QR code encodes so a phone can take the photo."""
    employee = await _visible(db, me, payload.employee_id)
    origin = payload.origin or request.headers.get("origin") or str(request.base_url).rstrip("/")
    token = await photos.create_token(db, me, employee, origin)
    return PhotoTokenOut(
        token=token.token,
        employee_id=employee.id,
        url=photos.token_url(origin, token.token),
        expires_at=token.expires_at,
    )


# Token routes: no session - the phone opens the QR link without signing in.


@router.get(
    "/photo-tokens/{token}",
    response_model=PhotoTokenInfoOut,
    responses={410: {"model": ErrorOut}},
    name="payroll:photo_token",
)
async def photo_token_info(token: str, db: DbSession) -> PhotoTokenInfoOut:
    row = await photos.live_token(db, token)
    employee = await services.get_employee(db, row.employee_id)
    logins = await services.logins_for(db, [employee.id])
    return PhotoTokenInfoOut(
        employee=services.employee_out(employee, logins.get(employee.id)), expires_at=row.expires_at
    )


@router.post(
    "/photo-tokens/{token}/photo",
    response_model=EmployeeOut,
    responses={410: {"model": ErrorOut}, 422: {"model": CodedErrorOut}},
    name="payroll:photo_token_upload",
)
async def photo_token_upload(token: str, db: DbSession, request: Request) -> EmployeeOut:
    """Stores the photo and burns the token (single use)."""
    row = await photos.live_token(db, token)
    raw = await _photo_bytes(request)
    employee = await photos.use_token(db, row, raw)
    logins = await services.logins_for(db, [employee.id])
    return services.employee_out(employee, logins.get(employee.id))


# --------------------------------------------------------------------------- widgets


async def payments_today(ctx: WidgetContext) -> list[dict[str, Any]]:
    """Today's payments (Kathmandu day) of the employees the caller may see, newest first:
    ``{payment_id, employee_id, name, kind, amount, mode, time}``."""
    scope = await services.scope_for(ctx.db, ctx.user, None)
    query = (
        select(Payment)
        .join(Employee, Employee.id == Payment.employee_id)
        .where(Payment.date == bsdate.today_ad(), Payment.voided_at.is_(None))
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
    )
    if scope.branch_id is not None:
        query = query.where(Employee.branch_id == scope.branch_id)
    modes = await services.modes_by_id(ctx.db)
    rows: list[dict[str, Any]] = []
    for p in await ctx.db.scalars(query):
        rows.append(
            {
                "payment_id": p.id,
                "employee_id": p.employee_id,
                "name": p.employee.full_name,
                "kind": p.kind.value,
                "amount": p.amount,
                "mode": modes[p.payment_mode_id].name,
                "time": p.paid_at.astimezone(bsdate.KATHMANDU).strftime("%H:%M"),
            }
        )
    return rows


def payments_today_data(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """``PaymentsTodayWidgetData``: today's date (both calendars), the count and totals (all /
    salary / advance, rupees), the payments newest first, and the Payment reports link."""
    header = bsdate.header_date()
    return {
        "date": header.ad_date.isoformat(),
        "date_bs": header.bs_date.isoformat(),
        "count": len(rows),
        "total": sum(p["amount"] for p in rows),
        "salary_total": sum(p["amount"] for p in rows if p["kind"] == "salary"),
        "advance_total": sum(p["amount"] for p in rows if p["kind"] == "advance"),
        "payments": rows,
        "payments_path": "/people/payments",
    }


async def payments_today_widget(ctx: WidgetContext) -> dict[str, Any]:
    """The "Payments today" card (web/app/people/_components/widgets), branch-scoped."""
    return {
        "kind": "payments_today",
        "title": "Payments today",
        "data": payments_today_data(await payments_today(ctx)),
    }


async def payroll_today_counts(ctx: WidgetContext) -> dict[str, Any]:
    """Payroll's share of ``GET /api/today`` ``counts`` (``TodayCountsOut``): rupees paid today
    and the number of payments, for the caller's branch(es)."""
    rows = await payments_today(ctx)
    return {"paid_today": sum(p["amount"] for p in rows), "payments_today": len(rows)}


# Attendance's scan flow and report badges reach payroll through app/contracts.py.
contract.register()


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
