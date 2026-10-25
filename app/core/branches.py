"""``/api/core/branches`` - the shops employees belong to.

Branches are never deleted (employees, attendance and payments reference them): they are
deactivated, which hides them from pickers while history stays. Names are trimmed and unique
case- and whitespace-insensitively through the generated ``name_norm`` column.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_access
from app.core.errors import ApiError, CodedErrorOut
from app.core.models import Branch, Employee, EmployeeStatus, User
from app.core.schemas import BranchIn, BranchOut, BranchPatchIn, ErrorOut
from app.core.services import find_branch, record_audit
from app.db import DbSession

router = APIRouter(prefix="/api/core/branches", tags=["core"])

CanManage = Annotated[User, Depends(require_access("manage_employees"))]

DUPLICATE_NAME = "A branch with this name already exists."
LAST_ACTIVE = "At least one active branch is needed."


async def employee_counts(db: AsyncSession) -> dict[int, tuple[int, int]]:
    rows = await db.execute(
        select(
            Employee.branch_id,
            func.count(),
            func.count().filter(Employee.status == EmployeeStatus.active),
        ).group_by(Employee.branch_id)
    )
    return {branch_id: (int(total), int(active)) for branch_id, total, active in rows}


def branch_out(branch: Branch, counts: tuple[int, int] = (0, 0)) -> BranchOut:
    total, active = counts
    return BranchOut(
        id=branch.id,
        name=branch.name,
        is_active=branch.is_active,
        employee_count=total,
        active_employee_count=active,
    )


async def get_branch_or_404(db: AsyncSession, branch_id: int) -> Branch:
    branch = await db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such branch.")
    return branch


async def check_name_free(db: AsyncSession, name: str, except_id: int | None = None) -> None:
    other = await find_branch(db, name)
    if other is not None and other.id != except_id:
        raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name")


@router.get("", response_model=list[BranchOut], responses={401: {"model": ErrorOut}})
async def list_branches(user: CurrentUser, db: DbSession, active: bool = False) -> list[BranchOut]:
    """Every branch A-Z with employee counts; ``?active=1`` leaves deactivated ones out."""
    counts = await employee_counts(db)
    query = select(Branch).order_by(Branch.name)
    if active:
        query = query.where(Branch.is_active.is_(True))
    branches = (await db.scalars(query)).all()
    return [branch_out(b, counts.get(b.id, (0, 0))) for b in branches]


@router.post(
    "",
    response_model=BranchOut,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"model": ErrorOut}, 409: {"model": CodedErrorOut}},
)
async def create_branch(me: CanManage, db: DbSession, payload: BranchIn) -> BranchOut:
    await check_name_free(db, payload.name)
    branch = Branch(name=payload.name)
    db.add(branch)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name") from None
    await record_audit(
        db,
        module="core",
        action="create",
        entity="branch",
        entity_id=branch.id,
        user_id=me.id,
        data={"after": {"name": branch.name}},
    )
    await db.commit()
    return branch_out(branch)


@router.patch(
    "/{branch_id}",
    response_model=BranchOut,
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 409: {"model": CodedErrorOut}},
)
async def update_branch(
    branch_id: int, me: CanManage, db: DbSession, payload: BranchPatchIn
) -> BranchOut:
    """Rename and / or (de)activate. The last active branch cannot be deactivated."""
    branch = await get_branch_or_404(db, branch_id)
    before = {"name": branch.name, "is_active": branch.is_active}
    if payload.name is not None and payload.name != branch.name:
        await check_name_free(db, payload.name, except_id=branch.id)
        branch.name = payload.name
    if payload.is_active is not None and payload.is_active != branch.is_active:
        if not payload.is_active:
            others = await db.scalar(
                select(func.count())
                .select_from(Branch)
                .where(Branch.is_active.is_(True), Branch.id != branch.id)
            )
            if not others:
                raise ApiError(status.HTTP_409_CONFLICT, LAST_ACTIVE, "last_active_branch")
        branch.is_active = payload.is_active
    after = {"name": branch.name, "is_active": branch.is_active}
    if after != before:
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name") from None
        if after["name"] != before["name"]:
            action = "rename"
        else:
            action = "activate" if after["is_active"] else "deactivate"
        await record_audit(
            db,
            module="core",
            action=action,
            entity="branch",
            entity_id=branch.id,
            user_id=me.id,
            data={"before": before, "after": after},
        )
        await db.commit()
    counts = await employee_counts(db)
    return branch_out(branch, counts.get(branch.id, (0, 0)))
