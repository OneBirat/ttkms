"""Core JSON endpoints: modules, registry, dashboard, today's date, BS conversion, export demo."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core import bsdate
from app.core.auth import CurrentUser
from app.core.export import (
    PDF_MEDIA_TYPE,
    XLSX_MEDIA_TYPE,
    Column,
    PDFUnavailable,
    to_pdf,
    to_xlsx,
)
from app.core.models import Branch, Department, Employee, EmployeeStatus, User
from app.core.modules import WidgetContext
from app.core.schemas import (
    BsConvertOut,
    DashboardOut,
    ErrorOut,
    ModuleOut,
    ModulesOut,
    NavItemOut,
    NavLinkOut,
    NavSectionOut,
    RegistryOut,
    StatOut,
    TodayOut,
    TodayText,
    WidgetOut,
    resolve_date,
)
from app.core.services import company_name
from app.db import DbSession
from app.modules.admin.permissions import access_for_user

router = APIRouter(prefix="/api", tags=["core"])


@router.get("/core/modules", response_model=ModulesOut, responses={401: {"model": ErrorOut}})
async def modules(request: Request, user: CurrentUser, db: DbSession) -> ModulesOut:
    """Enabled module names plus the sidebar sections (nav items filtered to the caller's
    effective permissions, modules with nothing visible left out). The Next.js shell, the
    post-login landing page and the route guard in ``web/middleware.ts`` all read this instead
    of hard-coding links."""
    loaded = request.app.state.modules
    access = await access_for_user(db, user)
    nav = []
    for module in loaded:
        items = [
            NavLinkOut(label=i.label, path=i.path, icon=i.icon)
            for i in module.visible_nav(user.role, access)
        ]
        if items:
            nav.append(NavSectionOut(module=module.name, title=module.title, items=items))
    return ModulesOut(enabled=[m.name for m in loaded], nav=nav)


@router.get("/registry", response_model=RegistryOut, responses={401: {"model": ErrorOut}})
async def registry(request: Request, user: CurrentUser, db: DbSession) -> RegistryOut:
    """Enabled modules in sidebar order, nav items filtered to the caller's effective
    permissions (role preset + per-user switches)."""
    access = await access_for_user(db, user)
    modules = []
    for module in request.app.state.modules:
        nav = [
            NavItemOut(
                label=i.label,
                path=i.path,
                icon=i.icon,
                roles=sorted(i.roles),
                permission=i.permission,
            )
            for i in module.visible_nav(user.role, access)
        ]
        modules.append(
            ModuleOut(
                name=module.name,
                title=module.title,
                nav=nav,
                allowed=module.allowed(user.role, access),
            )
        )
    return RegistryOut(modules=modules)


async def _count(db: AsyncSession, model: Any, *where: Any) -> int:
    stmt = select(func.count()).select_from(model)
    if where:
        stmt = stmt.where(*where)
    return int(await db.scalar(stmt) or 0)


@router.get("/dashboard", response_model=DashboardOut, responses={401: {"model": ErrorOut}})
async def dashboard(request: Request, user: CurrentUser, db: DbSession) -> DashboardOut:
    stats = [
        StatOut(
            label="Active employees",
            value=await _count(db, Employee, Employee.status == EmployeeStatus.active),
            hint="core.employees",
            tone="ok",
            href="/payroll",
        ),
        StatOut(label="Branches", value=await _count(db, Branch), hint="core.branches"),
        StatOut(label="Departments", value=await _count(db, Department), hint="core.departments"),
        StatOut(label="Users", value=await _count(db, User), hint="core.users", href="/admin"),
    ]
    ctx = WidgetContext(request=request, user=user, db=db)
    widgets: list[WidgetOut] = []
    for module in request.app.state.modules:
        for widget in module.dashboard_widgets:
            result = await widget(ctx)
            widgets.append(
                WidgetOut(
                    module=module.name,
                    kind=str(result.get("kind", "unknown")),
                    title=str(result.get("title", module.title)),
                    data=dict(result.get("data") or {}),
                )
            )
    return DashboardOut(stats=stats, widgets=widgets)


@router.get("/today", response_model=TodayOut)
async def today() -> TodayOut:
    """Today in Asia/Kathmandu, both calendars, with the header texts."""
    header = bsdate.header_date()
    return TodayOut(
        date=header.ad_date,
        date_bs=header.bs_date,
        weekday=header.bs_date.weekday,
        fiscal_year=bsdate.fiscal_year(header.bs_date).label,
        text=TodayText(np=header.np, bs_en=header.bs_en, ad=header.ad, full=header.full),
    )


@router.get("/bsdate/convert", response_model=BsConvertOut, responses={422: {"model": ErrorOut}})
async def convert_date(date: date | None = None, date_bs: str | None = None) -> BsConvertOut:
    """Convert one date either way: ``?date=2026-10-24`` (AD) or ``?date_bs=2083-07-07``."""
    try:
        ad = resolve_date(date, bsdate.parse_bs(date_bs) if date_bs else None)
        bs = bsdate.ad_to_bs(ad)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return BsConvertOut(
        date=ad,
        date_bs=bs,
        weekday=bs.weekday,
        fiscal_year=bsdate.fiscal_year(bs).label,
        bs_text=bsdate.format_bs(bs),
        bs_text_np=bsdate.format_bs(bs, lang="ne"),
        weekday_np=bsdate.weekday_name(ad, "ne"),
    )


# --------------------------------------------------------------------------- export demo

DEMO_COLUMNS = [
    Column("code", "Code"),
    Column("name", "Item"),
    Column("name_np", "नाम (नेपाली)"),
    Column("qty", "Qty", number_format="0"),
    Column("unit", "Unit"),
    Column("status", "Status"),
    Column("updated", "Updated (BS)"),
]
DEMO_ROWS: list[dict[str, Any]] = [
    {"code": "PC-5L", "name": "Pressure cooker 5 L", "name_np": "प्रेसर कुकर ५ लि", "qty": 24,
     "unit": "pcs", "status": "ok", "updated": "2083-07-02"},
    {"code": "GS-2B", "name": "Gas stove 2 burner", "name_np": "ग्यास चुलो २ बर्नर", "qty": 3,
     "unit": "pcs", "status": "low", "updated": "2083-07-01"},
    {"code": "MG-750", "name": "Mixer grinder 750 W", "name_np": "मिक्सर ग्राइन्डर ७५० वाट",
     "qty": 0, "unit": "pcs", "status": "out", "updated": "2083-06-28"},
    {"code": "RC-18", "name": "Rice cooker 1.8 L", "name_np": "राइस कुकर १.८ लि", "qty": 12,
     "unit": "pcs", "status": "ok", "updated": "2083-07-04"},
    {"code": "IC-2000", "name": "Induction cooktop 2000 W", "name_np": "इन्डक्सन चुलो २००० वाट",
     "qty": 5, "unit": "pcs", "status": "low", "updated": "2083-07-03"},
]  # fmt: skip
DEMO_LEGEND = [("OK", "ok"), ("Low", "low"), ("Out", "danger")]
DEMO_TITLE = "Export demo - sample rows"


@router.get("/core/export-demo.xlsx", name="export_demo_xlsx", include_in_schema=False)
async def export_demo_xlsx(user: CurrentUser, db: DbSession) -> Response:
    company = await company_name(db)
    meta = [company, bsdate.header_date().full, f"Printed by {user.full_name}"]
    data = await run_in_threadpool(to_xlsx, DEMO_TITLE, meta, DEMO_COLUMNS, DEMO_ROWS)
    return Response(
        data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="ttk-export-demo.xlsx"'},
    )


@router.get("/core/export-demo.pdf", name="export_demo_pdf", include_in_schema=False)
async def export_demo_pdf(user: CurrentUser, db: DbSession, landscape: bool = False) -> Response:
    context = {
        "title": DEMO_TITLE,
        "company": await company_name(db),
        "printed_by": user.full_name,
        "legend": DEMO_LEGEND,
        "columns": DEMO_COLUMNS,
        "rows": DEMO_ROWS,
    }
    try:
        pdf = await run_in_threadpool(to_pdf, "print/export_demo.html", context, landscape)
    except PDFUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return Response(
        pdf,
        media_type=PDF_MEDIA_TYPE,
        headers={"Content-Disposition": 'inline; filename="ttk-export-demo.pdf"'},
    )
