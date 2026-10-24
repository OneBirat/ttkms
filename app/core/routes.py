"""Core JSON endpoints: modules, registry, dashboard widgets, today (date and counts), BS dates."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Request, status

from app.core import bsdate
from app.core.auth import CurrentUser, OptionalUser
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
    TodayCountsOut,
    TodayOut,
    TodayText,
    WidgetOut,
    resolve_date,
)
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


@router.get("/dashboard", response_model=DashboardOut, responses={401: {"model": ErrorOut}})
async def dashboard(request: Request, user: CurrentUser, db: DbSession) -> DashboardOut:
    """The enabled modules' dashboard widgets, in sidebar order."""
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
    return DashboardOut(widgets=widgets)


async def today_counts(request: Request, user, db) -> TodayCountsOut:
    """Merge every enabled module's ``today_counts`` into one row (see ``TodayCountsOut``)."""
    ctx = WidgetContext(request=request, user=user, db=db)
    merged: dict[str, int] = {}
    for module in request.app.state.modules:
        if module.today_counts is not None:
            merged.update(await module.today_counts(ctx))
    return TodayCountsOut(**merged)


@router.get("/today", response_model=TodayOut)
async def today(request: Request, user: OptionalUser, db: DbSession) -> TodayOut:
    """Today in Asia/Kathmandu, both calendars, with the header texts - public. A signed-in
    caller also gets ``counts``, the dashboard's headline numbers for today."""
    header = bsdate.header_date()
    return TodayOut(
        date=header.ad_date,
        date_bs=header.bs_date,
        weekday=header.bs_date.weekday,
        fiscal_year=bsdate.fiscal_year(header.bs_date).label,
        text=TodayText(np=header.np, bs_en=header.bs_en, ad=header.ad, full=header.full),
        counts=await today_counts(request, user, db) if user is not None else None,
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
