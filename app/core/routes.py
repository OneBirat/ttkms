"""Core pages: the dashboard shell and the export demo routes (deliberately not in the nav)."""

from __future__ import annotations

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
from app.core.services import company_name
from app.core.templating import render
from app.db import DbSession

router = APIRouter()


async def _count(db: AsyncSession, model: Any, *where: Any) -> int:
    stmt = select(func.count()).select_from(model)
    if where:
        stmt = stmt.where(*where)
    return int(await db.scalar(stmt) or 0)


@router.get("/", name="dashboard")
async def dashboard(request: Request, user: CurrentUser, db: DbSession) -> Response:
    stats = [
        {
            "label": "Active employees",
            "value": await _count(db, Employee, Employee.status == EmployeeStatus.active),
            "hint": "core.employees",
            "tone": "ok",
        },
        {"label": "Branches", "value": await _count(db, Branch), "hint": "core.branches"},
        {"label": "Departments", "value": await _count(db, Department), "hint": "core.departments"},
        {"label": "Users", "value": await _count(db, User), "hint": "core.users"},
    ]
    widgets: list[tuple[Any, str]] = []
    ctx = WidgetContext(request=request, user=user, db=db)
    for module in request.app.state.modules:
        for widget in module.dashboard_widgets:
            widgets.append((module, await widget(ctx)))
    return render(request, "dashboard.html", {"stats": stats, "widgets": widgets})


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
DEMO_TITLE = "Export demo - stock items"


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
