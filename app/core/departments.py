"""``/api/core/departments`` - the global list employees are grouped by.

Departments are company-wide (``core.departments`` has no branch column); names are trimmed
and unique case- and whitespace-insensitively through the table's generated ``name_norm``
column. ``is_active`` stays on the table but the API ignores it: a department is listed until
it is deleted, and it can only be deleted while no employee - active or former - references it
(``core.employees.department_id`` is ``ON DELETE RESTRICT``).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_access
from app.core.errors import ApiError, CodedErrorOut
from app.core.models import Department, Employee, EmployeeStatus, User
from app.core.schemas import DepartmentIn, DepartmentOut, ErrorOut
from app.core.services import find_department, record_audit
from app.db import DbSession

router = APIRouter(prefix="/api/core/departments", tags=["core"])

#: Who may add, rename and delete departments (admin preset and manager preset both hold it).
CanManage = Annotated[User, Depends(require_access("manage_employees"))]

DUPLICATE_NAME = "A department with this name already exists."
IN_USE = "Move the employees of this department first."


async def employee_counts(db: AsyncSession) -> dict[int, tuple[int, int]]:
    """``{department_id: (all employees, active employees)}`` - former staff count too."""
    rows = await db.execute(
        select(
            Employee.department_id,
            func.count(),
            func.count().filter(Employee.status == EmployeeStatus.active),
        )
        .where(Employee.department_id.is_not(None))
        .group_by(Employee.department_id)
    )
    return {dept_id: (int(total), int(active)) for dept_id, total, active in rows}


def department_out(department: Department, counts: tuple[int, int] = (0, 0)) -> DepartmentOut:
    total, active = counts
    return DepartmentOut(
        id=department.id,
        name=department.name,
        employee_count=total,
        active_employee_count=active,
    )


async def get_department_or_404(db: AsyncSession, department_id: int) -> Department:
    department = await db.get(Department, department_id)
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such department.")
    return department


async def check_name_free(db: AsyncSession, name: str, except_id: int | None = None) -> None:
    other = await find_department(db, name)
    if other is not None and other.id != except_id:
        raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name")


@router.get("", response_model=list[DepartmentOut], responses={401: {"model": ErrorOut}})
async def list_departments(user: CurrentUser, db: DbSession) -> list[DepartmentOut]:
    """Every department, A-Z, with how many employees (and how many active) it has."""
    counts = await employee_counts(db)
    departments = (await db.scalars(select(Department).order_by(Department.name))).all()
    return [department_out(d, counts.get(d.id, (0, 0))) for d in departments]


@router.post(
    "",
    response_model=DepartmentOut,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"model": ErrorOut}, 409: {"model": CodedErrorOut}},
)
async def create_department(me: CanManage, db: DbSession, payload: DepartmentIn) -> DepartmentOut:
    await check_name_free(db, payload.name)
    department = Department(name=payload.name)
    db.add(department)
    try:
        await db.flush()
    except IntegrityError:  # lost a race with a concurrent create
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name") from None
    await record_audit(
        db,
        module="core",
        action="create",
        entity="department",
        entity_id=department.id,
        user_id=me.id,
        data={"after": {"name": department.name}},
    )
    await db.commit()
    return department_out(department)


@router.patch(
    "/{department_id}",
    response_model=DepartmentOut,
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 409: {"model": CodedErrorOut}},
)
async def rename_department(
    department_id: int, me: CanManage, db: DbSession, payload: DepartmentIn
) -> DepartmentOut:
    department = await get_department_or_404(db, department_id)
    before = department.name
    if payload.name != before:
        await check_name_free(db, payload.name, except_id=department.id)
        department.name = payload.name
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise ApiError(status.HTTP_409_CONFLICT, DUPLICATE_NAME, "duplicate_name") from None
        await record_audit(
            db,
            module="core",
            action="rename",
            entity="department",
            entity_id=department.id,
            user_id=me.id,
            data={"before": {"name": before}, "after": {"name": department.name}},
        )
        await db.commit()
    counts = await employee_counts(db)
    return department_out(department, counts.get(department.id, (0, 0)))


@router.delete(
    "/{department_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={403: {"model": ErrorOut}, 404: {"model": ErrorOut}, 409: {"model": CodedErrorOut}},
)
async def delete_department(department_id: int, me: CanManage, db: DbSession) -> None:
    """Hard delete. Refused with ``409 department_in_use`` while any employee - active or
    former - references it; the count is taken in the same transaction, behind a row lock."""
    department = await db.scalar(
        select(Department).where(Department.id == department_id).with_for_update()
    )
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such department.")
    total, active = (await employee_counts(db)).get(department.id, (0, 0))
    if total:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            IN_USE,
            "department_in_use",
            count=total,
            inactive_count=total - active,
        )
    await db.delete(department)
    try:
        await db.flush()
    except IntegrityError:  # an employee was moved in between: the FK (RESTRICT) caught it
        await db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT, IN_USE, "department_in_use", count=1, inactive_count=0
        ) from None
    await record_audit(
        db,
        module="core",
        action="delete",
        entity="department",
        entity_id=department_id,
        user_id=me.id,
        data={"before": {"name": department.name}},
    )
    await db.commit()
