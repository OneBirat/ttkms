"""Public holidays: one dated entry each, for every branch or a chosen list (no recurrence).

* Only the super admin writes them (routes.py), and only for today or a later day - "today" is
  the Kathmandu day on the server. Once its day has passed a holiday is locked: nobody can edit
  or delete it. :func:`guard_write` is the one check behind create, edit and delete.
* Two holidays never share a date and a branch (409); an all-branches holiday overlaps everything.
* Holidays are applied when attendance and pay are READ (:func:`for_branch`): the day list and
  the report show them, the month summary does not count the day as not marked. Nothing is ever
  written to the attendance records for a holiday.
"""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import bsdate
from app.core.errors import ApiError
from app.core.models import Branch, User
from app.modules.attendance import schemas, services
from app.modules.attendance.models import HOLIDAY_NAME_MAX, Holiday, HolidayBranch

# ------------------------------------------------------------------------------- reading


async def in_range(db: AsyncSession, start: date, end: date) -> list[Holiday]:
    return list(
        await db.scalars(
            select(Holiday)
            .where(Holiday.date >= start, Holiday.date <= end)
            .order_by(Holiday.date, Holiday.id)
        )
    )


async def for_branch(
    db: AsyncSession, branch_id: int | None, start: date, end: date
) -> dict[date, Holiday]:
    """The holidays of one branch by date (at most one per day: overlaps are refused). No
    branch (an employee without one) = only the all-branches holidays."""
    return {
        h.date: h
        for h in await in_range(db, start, end)
        if h.all_branches or (branch_id is not None and h.applies_to(branch_id))
    }


async def on_day(db: AsyncSession, branch_id: int | None, ad: date) -> Holiday | None:
    return (await for_branch(db, branch_id, ad, ad)).get(ad)


def paid_map(holidays: dict[date, Holiday]) -> dict[date, bool]:
    """date -> is_paid, the shape :func:`contract.summarise` takes."""
    return {day: h.is_paid for day, h in holidays.items()}


def ref(holiday: Holiday | None) -> schemas.HolidayRef | None:
    if holiday is None:
        return None
    return schemas.HolidayRef(id=holiday.id, name=holiday.name, is_paid=holiday.is_paid)


def out(holiday: Holiday, branch_names: dict[int, str]) -> schemas.HolidayOut:
    ids = sorted(b.branch_id for b in holiday.branches) if not holiday.all_branches else []
    return schemas.HolidayOut(
        id=holiday.id,
        date=holiday.date,
        date_bs=services.bs_of(holiday.date),
        weekday=bsdate.weekday_index(holiday.date),
        name=holiday.name,
        all_branches=holiday.all_branches,
        branch_ids=ids,
        branch_names=[branch_names.get(i, f"Branch {i}") for i in ids],
        is_paid=holiday.is_paid,
        is_weekly_off=services.is_weekly_off(holiday.date),
        locked=is_locked(holiday.date),
    )


async def _branch_names(db: AsyncSession) -> dict[int, str]:
    return {b.id: b.name for b in await db.scalars(select(Branch))}


async def list_holidays(
    db: AsyncSession, start: date, end: date, branch_id: int | None
) -> schemas.HolidayList:
    if start > end:
        raise services.invalid('"from" is after "to".', "from")
    rows = await in_range(db, start, end)
    if branch_id is not None:
        rows = [h for h in rows if h.applies_to(branch_id)]
    names = await _branch_names(db)
    return schemas.HolidayList(today=services.today(), holidays=[out(h, names) for h in rows])


# ------------------------------------------------------------------------------- writing


def is_locked(ad: date) -> bool:
    """A holiday whose day has passed (Kathmandu) can never be edited or deleted."""
    return ad < services.today()


def guard_write(existing: Holiday | None = None, new_date: date | None = None) -> None:
    """The one date rule of every write: an existing holiday must not be locked (403), and the
    date being saved must be today or later (422). Create passes ``new_date``, delete passes
    ``existing``, edit passes both."""
    if existing is not None and is_locked(existing.date):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"{existing.name} ({services.bs_label(existing.date)}) has passed and is "
            "locked. Past holidays cannot be changed or deleted.",
        )
    if new_date is not None and is_locked(new_date):
        raise services.invalid(
            f"{services.bs_label(new_date)} has passed. A holiday can only be marked for today "
            "or a later day.",
            "date",
        )


def _clean_name(name: str | None) -> str:
    text = " ".join((name or "").split())
    if not text:
        raise services.invalid("Give the holiday a name.", "name")
    if len(text) > HOLIDAY_NAME_MAX:
        raise services.invalid(f"Keep the name within {HOLIDAY_NAME_MAX} characters.", "name")
    return text


async def _clean_branches(db: AsyncSession, all_branches: bool, branch_ids: list[int]) -> list[int]:
    if all_branches:
        return []
    ids = sorted(set(branch_ids))
    if not ids:
        raise services.invalid("Choose at least one branch.", "branch_ids")
    known = set(await db.scalars(select(Branch.id).where(Branch.id.in_(ids))))
    if known != set(ids):
        raise services.invalid("One of the chosen branches does not exist.", "branch_ids")
    return ids


async def _check_overlap(
    db: AsyncSession, ad: date, all_branches: bool, branch_ids: list[int], skip_id: int | None
) -> None:
    """409 when another holiday on that date shares a branch (all branches shares every one)."""
    for other in await in_range(db, ad, ad):
        if other.id == skip_id:
            continue
        shared = (
            all_branches
            or other.all_branches
            or bool({b.branch_id for b in other.branches} & set(branch_ids))
        )
        if shared:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                f"{services.bs_label(ad)} is already a holiday ({other.name}) for "
                + ("all branches." if other.all_branches else "one of these branches."),
                "holiday_overlap",
                field="date",
                holiday_id=other.id,
            )


async def create(db: AsyncSession, actor: User, body: schemas.HolidayIn) -> schemas.HolidayOut:
    guard_write(new_date=body.date)
    name = _clean_name(body.name)
    branch_ids = await _clean_branches(db, body.all_branches, body.branch_ids)
    await _check_overlap(db, body.date, body.all_branches, branch_ids, None)
    holiday = Holiday(
        date=body.date,
        name=name,
        all_branches=body.all_branches,
        is_paid=body.is_paid,
        created_by=actor.id,
        branches=[HolidayBranch(branch_id=i) for i in branch_ids],
    )
    db.add(holiday)
    await db.commit()
    await db.refresh(holiday)
    return out(holiday, await _branch_names(db))


async def get(db: AsyncSession, holiday_id: int) -> Holiday:
    holiday = await db.get(Holiday, holiday_id)
    if holiday is None:
        raise services.not_found("No such holiday.")
    return holiday


async def update(
    db: AsyncSession, holiday_id: int, body: schemas.HolidayPatch
) -> schemas.HolidayOut:
    holiday = await get(db, holiday_id)
    sent = body.model_fields_set
    new_date = body.date if "date" in sent and body.date is not None else holiday.date
    guard_write(existing=holiday, new_date=new_date)
    if "name" in sent:
        holiday.name = _clean_name(body.name)
    all_branches = (
        body.all_branches
        if "all_branches" in sent and body.all_branches is not None
        else holiday.all_branches
    )
    current_ids = [b.branch_id for b in holiday.branches]
    asked_ids = body.branch_ids if "branch_ids" in sent and body.branch_ids is not None else None
    branch_ids = await _clean_branches(
        db, all_branches, asked_ids if asked_ids is not None else current_ids
    )
    await _check_overlap(db, new_date, all_branches, branch_ids, holiday.id)
    holiday.date = new_date
    holiday.all_branches = all_branches
    if "is_paid" in sent and body.is_paid is not None:
        holiday.is_paid = body.is_paid
    if set(branch_ids) != set(current_ids):
        holiday.branches = [HolidayBranch(branch_id=i) for i in branch_ids]
    await db.commit()
    await db.refresh(holiday)
    return out(holiday, await _branch_names(db))


async def delete(db: AsyncSession, holiday_id: int) -> None:
    holiday = await get(db, holiday_id)
    guard_write(existing=holiday)
    await db.delete(holiday)
    await db.commit()
