"""/api/attendance endpoints (API_NOTES.md). Every route names its guard; branch scoping is
server-side (:func:`app.modules.attendance.access.scope_for`)."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.auth import CurrentUser
from app.core.errors import CodedErrorOut
from app.core.models import User
from app.core.schemas import ErrorOut, ModuleStatusOut
from app.db import DbSession
from app.modules.admin.permissions import require_any_access
from app.modules.attendance import holidays, preview, report, schemas, services
from app.modules.attendance.access import (
    EMPLOYEES,
    MARK,
    REPORT,
    CanMark,
    CanReport,
    SuperAdmin,
    scope_for,
    sees_money,
)

router = APIRouter()

AnyAttendance = Annotated[User, Depends(require_any_access(MARK, REPORT))]
# The employee month is also the account page's Attendance card (manage_employees).
MonthReader = Annotated[User, Depends(require_any_access(MARK, REPORT, EMPLOYEES))]
ERRORS: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorOut},
    404: {"model": ErrorOut},
    422: {"model": CodedErrorOut},
}


@router.get("", response_model=ModuleStatusOut, name="attendance:index")
async def index(me: AnyAttendance) -> ModuleStatusOut:
    return ModuleStatusOut(module="attendance", title="Attendance", status="ready")


# ------------------------------------------------------------------------------- marking


@router.get("/day", response_model=schemas.DayAttendance, responses=ERRORS)
async def get_day(
    me: CanMark,
    db: DbSession,
    date_bs: str,
    branch: int | None = None,
    department_id: int | None = None,
) -> schemas.DayAttendance:
    scope = await scope_for(db, me, branch)
    return await services.day_attendance(
        db, scope, date_bs, department_id, money=await sees_money(db, me), user=me
    )


@router.post("/mark", response_model=schemas.MarkOneResponse, responses=ERRORS)
async def mark(body: schemas.MarkOneRequest, me: CanMark, db: DbSession) -> schemas.MarkOneResponse:
    """Mark one person for one day (P, O + hours, A) - also how a status or the overtime hours
    change: one upsert on (employee, day)."""
    return await services.mark_one(db, me, await scope_for(db, me, None), body)


@router.delete("/mark", response_model=schemas.ClearMarkResponse, responses=ERRORS)
async def clear_mark(
    me: CanMark, db: DbSession, employee_id: int, date_bs: str, reason: str | None = None
) -> schemas.ClearMarkResponse:
    """ "Clear mark": back to not marked (weekly off on a Saturday). ``reason`` is required when
    the super admin clears a mark on a past day."""
    return await services.clear_mark(
        db, me, await scope_for(db, me, None), employee_id, date_bs, reason
    )


@router.post("/bulk-mark", response_model=schemas.BulkMarkResponse, responses=ERRORS)
async def bulk_mark(
    body: schemas.BulkMarkRequest, me: CanMark, db: DbSession
) -> schemas.BulkMarkResponse:
    scope = await scope_for(db, me, body.branch_id)
    return await services.bulk_present(db, me, scope, body)


# ----------------------------------------------------------------------------------- scan


@router.get("/lookup", response_model=schemas.LookupResponse, responses=ERRORS)
async def lookup(employee_id: int, me: CanMark, db: DbSession) -> schemas.LookupResponse:
    return await services.lookup(db, await scope_for(db, me, None), employee_id)


@router.post("/scan", response_model=schemas.ScanResponse, responses=ERRORS)
async def scan(body: schemas.ScanRequest, me: CanMark, db: DbSession) -> schemas.ScanResponse:
    return await services.scan_mark(db, me, await scope_for(db, me, None), body)


# --------------------------------------------------------------------------------- report


@router.get("/report", response_model=schemas.MonthReport, responses=ERRORS)
async def month_report(
    me: CanReport, db: DbSession, bs_year: int, bs_month: int, branch: int | None = None
) -> schemas.MonthReport:
    """One BS month; week and day views are sliced in the browser. ``branch`` left out = every
    branch (see_other_branches); without that permission it is always the user's own."""
    scope = await scope_for(db, me, branch)
    return await report.month_report(db, scope, bs_year, bs_month, money=await sees_money(db, me))


@router.get(
    "/employees/{employee_id}/month", response_model=schemas.EmployeeMonth, responses=ERRORS
)
async def employee_month(
    employee_id: int, me: MonthReader, db: DbSession, bs_year: int, bs_month: int
) -> schemas.EmployeeMonth:
    scope = await scope_for(db, me, None)
    return await report.employee_month(
        db, scope, employee_id, bs_year, bs_month, money=await sees_money(db, me)
    )


@router.post("/override-preview", response_model=schemas.OverridePreview, responses=ERRORS)
async def override_preview(
    body: schemas.OverridePreviewRequest, me: CanMark, db: DbSession
) -> schemas.OverridePreview:
    """Before the super admin changes a past day: old -> new per person and what it does to
    that month's pay - with a warning when the month's salary is already paid (fully or
    partly). Nothing is written and nothing is blocked. Super admin only (it shows pay)."""
    return await preview.override_preview(db, me, await scope_for(db, me, None), body)


@router.get("/history", response_model=schemas.MarkHistory, responses=ERRORS)
async def mark_history(
    me: MonthReader, db: DbSession, employee_id: int, date_bs: str
) -> schemas.MarkHistory:
    """Every create, change and removal of one employee's mark on one day: who, when, old ->
    new, the reason and whether it was a super-admin override. Read-only: history rows cannot
    be edited or deleted."""
    return await report.mark_history(db, await scope_for(db, me, None), employee_id, date_bs)


@router.get("/marked-days", response_model=schemas.MarkedDays, responses=ERRORS)
async def marked_days(
    me: AnyAttendance,
    db: DbSession,
    bs_year: int,
    bs_month: int,
    employee_id: int | None = None,
    branch: int | None = None,
) -> schemas.MarkedDays:
    """BS dates with a mark - for one employee, else for the branch (BSDatePicker dots)."""
    scope = await scope_for(db, me, branch)
    return await report.marked_days(db, scope, bs_year, bs_month, employee_id)


# ------------------------------------------------------------------------------ holidays

HOLIDAY_ERRORS: dict[int | str, dict[str, Any]] = {**ERRORS, 409: {"model": CodedErrorOut}}


@router.get("/holidays", response_model=schemas.HolidayList, responses=ERRORS)
async def list_holidays(
    me: CurrentUser,
    db: DbSession,
    from_: Annotated[date, Query(alias="from")],
    to: date,
    branch_id: int | None = None,
) -> schemas.HolidayList:
    """Public holidays in an AD date range (any signed-in user: Mark attendance, the reports and
    the dashboard read them). ``branch_id`` keeps only the holidays that apply to that branch.
    ``today`` is the Kathmandu day; ``locked`` = the holiday's day has passed."""
    return await holidays.list_holidays(db, from_, to, branch_id)


@router.post(
    "/holidays",
    response_model=schemas.HolidayOut,
    status_code=status.HTTP_201_CREATED,
    responses=HOLIDAY_ERRORS,
)
async def create_holiday(
    body: schemas.HolidayIn, me: SuperAdmin, db: DbSession
) -> schemas.HolidayOut:
    """Super admin only. 422 for a past date, a blank name or no branch chosen; 409 when the
    date already has a holiday for one of the branches."""
    return await holidays.create(db, me, body)


@router.patch("/holidays/{holiday_id}", response_model=schemas.HolidayOut, responses=HOLIDAY_ERRORS)
async def update_holiday(
    holiday_id: int, body: schemas.HolidayPatch, me: SuperAdmin, db: DbSession
) -> schemas.HolidayOut:
    """Super admin only. 403 once the holiday's day has passed; the new date must be today or
    later too."""
    return await holidays.update(db, holiday_id, body)


@router.delete(
    "/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT, responses=HOLIDAY_ERRORS
)
async def delete_holiday(holiday_id: int, me: SuperAdmin, db: DbSession) -> Response:
    """Super admin only. 403 once the holiday's day has passed."""
    await holidays.delete(db, holiday_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
