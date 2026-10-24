"""Admin business rules: users, their access and temporary passwords.

Every change writes one ``audit_log`` row (module ``admin``, ``data = {"before", "after"}``).
Rules the API enforces (the UI mirrors them):

* phone numbers are unique logins; a user created here signs in with their phone
* an admin cannot deactivate themselves or drop their own admin role
* at least one active admin must remain
* an employee can be linked to one user only
* managers and staff belong to one branch; admins see all branches
"""

from __future__ import annotations

import secrets
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import bsdate
from app.core.auth import hash_password
from app.core.models import Branch, Employee, Role, User
from app.core.services import norm_sql, record_audit
from app.modules.admin.models import PaymentMode, UserAccess
from app.modules.admin.permissions import clean_overrides, effective_access, is_custom
from app.modules.admin.schemas import (
    AdminUserOut,
    BranchRefOut,
    EmployeeRefOut,
    PaymentModeIn,
    PaymentModeOut,
    UserIn,
    UserOptionsOut,
)

SELF_DEACTIVATE = "You cannot deactivate your own account."
SELF_DEMOTE = "You cannot remove your own admin role."
LAST_ADMIN = "There must always be at least one active admin."
PHONE_TAKEN = "This phone already has a login."
EMPLOYEE_TAKEN = "That employee is already linked to another user."
BRANCH_REQUIRED = "Pick the branch this user works in."

# Temporary passwords look like "Kmtp-4821x": no 0/O/1/l/I, easy to read out over the phone.
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_LOWER = "abcdefghjkmnpqrstuvwxyz"
_DIGITS = "23456789"


def generate_temporary_password() -> str:
    rng = secrets.SystemRandom()
    return (
        rng.choice(_UPPER)
        + "".join(rng.choice(_LOWER) for _ in range(3))
        + "-"
        + "".join(rng.choice(_DIGITS) for _ in range(4))
        + rng.choice(_LOWER)
    )


def conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail=detail)


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def to_bs(value: datetime | None) -> str | None:
    if value is None:
        return None
    try:
        return bsdate.ad_to_bs(value).isoformat()
    except (bsdate.BSCalendarUnavailable, ValueError):
        return None


# ----------------------------------------------------------------------------- reading


def branch_ref(branch: Branch | None) -> BranchRefOut | None:
    if branch is None:
        return None
    return BranchRefOut(id=branch.id, name=branch.name, is_active=branch.is_active)


def employee_ref(employee: Employee | None, user_id: int | None = None) -> EmployeeRefOut | None:
    if employee is None:
        return None
    return EmployeeRefOut(
        id=employee.id,
        code=employee.code,
        full_name=employee.full_name,
        phone=employee.phone,
        department=employee.department.name if employee.department else None,
        branch_id=employee.branch_id,
        status=employee.status.value,
        user_id=user_id,
    )


def user_out(
    user: User,
    row: UserAccess | None,
    branches: dict[int, Branch],
    me: User,
) -> AdminUserOut:
    overrides = row.access if row else None
    branch = branches.get(row.branch_id) if row and row.branch_id else None
    return AdminUserOut(
        id=user.id,
        full_name=user.full_name,
        phone=user.phone,
        username=user.username,
        role=user.role,
        role_label=user.role_label,
        is_active=user.is_active,
        is_you=user.id == me.id,
        must_change_password=user.must_change_password,
        branch=branch_ref(branch),
        employee=employee_ref(user.employee, user.id),
        last_login_at=user.last_login_at,
        last_login_at_bs=to_bs(user.last_login_at),
        access=effective_access(user.role, overrides),
        custom=is_custom(user.role, overrides),
    )


async def _branches(db: AsyncSession) -> dict[int, Branch]:
    rows = (await db.execute(select(Branch).order_by(Branch.name))).scalars().all()
    return {branch.id: branch for branch in rows}


async def _access_rows(db: AsyncSession, user_ids: Iterable[int]) -> dict[int, UserAccess]:
    ids = list(user_ids)
    if not ids:
        return {}
    rows = (await db.execute(select(UserAccess).where(UserAccess.user_id.in_(ids)))).scalars().all()
    return {row.user_id: row for row in rows}


async def list_users(db: AsyncSession, me: User) -> list[AdminUserOut]:
    users = (await db.execute(select(User).order_by(User.full_name, User.id))).scalars().all()
    branches = await _branches(db)
    access = await _access_rows(db, (u.id for u in users))
    return [user_out(user, access.get(user.id), branches, me) for user in users]


async def get_user_out(db: AsyncSession, user: User, me: User) -> AdminUserOut:
    await db.refresh(user)
    row = await db.get(UserAccess, user.id)
    return user_out(user, row, await _branches(db), me)


async def get_user_or_404(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


async def user_options(db: AsyncSession) -> UserOptionsOut:
    branches = (
        (await db.execute(select(Branch).where(Branch.is_active).order_by(Branch.name)))
        .scalars()
        .all()
    )
    employees = (
        (await db.execute(select(Employee).order_by(Employee.full_name, Employee.id)))
        .scalars()
        .all()
    )
    linked = {
        employee_id: user_id
        for user_id, employee_id in (
            await db.execute(select(User.id, User.employee_id).where(User.employee_id.is_not(None)))
        ).all()
    }
    return UserOptionsOut(
        branches=[branch_ref(b) for b in branches if b is not None],  # type: ignore[misc]
        employees=[
            employee_ref(e, linked.get(e.id))  # type: ignore[misc]
            for e in employees
        ],
    )


# ----------------------------------------------------------------------------- guards


async def count_active_admins(db: AsyncSession) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(User).where(User.role == Role.admin, User.is_active)
        )
        or 0
    )


async def check_role_change(
    db: AsyncSession, actor: User, user: User, role: Role, is_active: bool
) -> None:
    """Raise 409 when the change would lock the system out or hit the actor themselves."""
    was_active_admin = user.role == Role.admin and user.is_active
    stays_active_admin = role == Role.admin and is_active
    if user.id == actor.id and user.is_active and not is_active:
        raise conflict(SELF_DEACTIVATE)
    if user.id == actor.id and user.role == Role.admin and role != Role.admin:
        raise conflict(SELF_DEMOTE)
    if was_active_admin and not stays_active_admin and await count_active_admins(db) <= 1:
        raise conflict(LAST_ADMIN)


async def check_phone_free(db: AsyncSession, phone: str, ignore_id: int | None) -> None:
    clash = await db.scalar(select(User.id).where(User.phone == phone, User.id != (ignore_id or 0)))
    if clash is not None:
        raise conflict(PHONE_TAKEN)
    # Usernames are a separate login; a phone must not collide with one either.
    clash = await db.scalar(
        select(User.id).where(User.username == phone, User.id != (ignore_id or 0))
    )
    if clash is not None:
        raise conflict(PHONE_TAKEN)


async def resolve_employee(
    db: AsyncSession, employee_id: int | None, ignore_user_id: int | None
) -> Employee | None:
    if employee_id is None:
        return None
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise invalid("That employee does not exist.")
    owner = await db.scalar(
        select(User.id).where(User.employee_id == employee_id, User.id != (ignore_user_id or 0))
    )
    if owner is not None:
        raise conflict(EMPLOYEE_TAKEN)
    return employee


async def resolve_branch(db: AsyncSession, role: Role, branch_id: int | None) -> int | None:
    """Admins: always all branches. Others: an existing branch is required."""
    if role == Role.admin:
        return None
    if branch_id is None:
        raise invalid(BRANCH_REQUIRED)
    branch = await db.get(Branch, branch_id)
    if branch is None:
        raise invalid("That branch does not exist.")
    return branch.id


# ----------------------------------------------------------------------------- writing


def snapshot(user: User, row: UserAccess | None) -> dict[str, Any]:
    return {
        "full_name": user.full_name,
        "phone": user.phone,
        "username": user.username,
        "role": user.role.value,
        "is_active": user.is_active,
        "employee_id": user.employee_id,
        "branch_id": row.branch_id if row else None,
        "access": row.access if row else None,
    }


async def _audit(
    db: AsyncSession,
    actor: User,
    action: str,
    user: User,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> None:
    await record_audit(
        db,
        module="admin",
        action=action,
        entity="user",
        entity_id=user.id,
        user_id=actor.id,
        data={"before": before, "after": after},
    )


async def _upsert_access(
    db: AsyncSession, user: User, branch_id: int | None, access: dict[str, bool] | None
) -> UserAccess:
    row = await db.get(UserAccess, user.id)
    if row is None:
        row = UserAccess(user_id=user.id)
        db.add(row)
    row.branch_id = branch_id
    row.access = access
    await db.flush()
    return row


async def create_user(db: AsyncSession, actor: User, data: UserIn) -> tuple[User, str]:
    """New sign-in: username = phone, temporary password, must change it at first sign-in."""
    await check_phone_free(db, data.phone, None)
    employee = await resolve_employee(db, data.employee_id, None)
    branch_id = await resolve_branch(db, data.role, data.branch_id)
    temporary = generate_temporary_password()
    user = User(
        username=data.phone,
        phone=data.phone,
        full_name=data.full_name,
        role=data.role,
        is_active=True,
        must_change_password=True,
        password_hash=hash_password(temporary),
        employee_id=employee.id if employee else None,
    )
    db.add(user)
    await db.flush()
    row = await _upsert_access(db, user, branch_id, clean_overrides(data.role, data.access))
    await _audit(db, actor, "create", user, None, snapshot(user, row))
    await db.commit()
    return user, temporary


async def update_user(db: AsyncSession, actor: User, user: User, data: UserIn) -> User:
    row = await db.get(UserAccess, user.id)
    before = snapshot(user, row)
    await check_role_change(db, actor, user, data.role, user.is_active)
    await check_phone_free(db, data.phone, user.id)
    employee = await resolve_employee(db, data.employee_id, user.id)
    branch_id = await resolve_branch(db, data.role, data.branch_id)

    # Keep "username = phone" for users who sign in with their phone.
    if user.username == (user.phone or ""):
        user.username = data.phone
    user.phone = data.phone
    user.full_name = data.full_name
    user.role = data.role
    user.employee_id = employee.id if employee else None
    row = await _upsert_access(db, user, branch_id, clean_overrides(data.role, data.access))
    after = snapshot(user, row)
    if after != before:
        await _audit(db, actor, "update", user, before, after)
    await db.commit()
    return user


async def set_user_active(db: AsyncSession, actor: User, user: User, is_active: bool) -> User:
    if user.is_active == is_active:
        return user
    await check_role_change(db, actor, user, user.role, is_active)
    row = await db.get(UserAccess, user.id)
    before = snapshot(user, row)
    user.is_active = is_active
    await db.flush()
    await _audit(
        db, actor, "activate" if is_active else "deactivate", user, before, snapshot(user, row)
    )
    await db.commit()
    return user


async def reset_password(db: AsyncSession, actor: User, user: User) -> str:
    temporary = generate_temporary_password()
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    await db.flush()
    await record_audit(
        db,
        module="admin",
        action="reset_password",
        entity="user",
        entity_id=user.id,
        user_id=actor.id,
        data={"before": None, "after": {"must_change_password": True}},
    )
    await db.commit()
    return temporary


# ----------------------------------------------------------------------------- payment modes

MODE_NAME_TAKEN = "A payment mode with this name already exists."
CASH_LOCKED = "Cash is built in and cannot be changed."
CASH_ALWAYS_ON = "Cash is always on."


async def payment_counts(db: AsyncSession) -> dict[int, int]:
    """Payments per mode from ``payroll.payments.payment_mode_id`` - empty until the payroll
    module has created that table (the admin module must not depend on payroll's models)."""
    exists = await db.scalar(text("SELECT to_regclass('payroll.payments')"))
    if exists is None:
        return {}
    rows = await db.execute(
        text("SELECT payment_mode_id, count(*) FROM payroll.payments GROUP BY payment_mode_id")
    )
    return {int(mode_id): int(n) for mode_id, n in rows.all() if mode_id is not None}


def mode_out(mode: PaymentMode, counts: dict[int, int]) -> PaymentModeOut:
    return PaymentModeOut(
        id=mode.id,
        type=mode.type,  # type: ignore[arg-type]
        name=mode.name,
        details=mode.details,
        use_salary=mode.use_salary,
        use_advance=mode.use_advance,
        active=mode.active,
        is_builtin=mode.is_builtin,
        payment_count=counts.get(mode.id, 0),
        created_at=mode.created_at,
    )


async def list_payment_modes(db: AsyncSession, active_only: bool) -> list[PaymentModeOut]:
    """Cash first, then the others in creation order."""
    query = select(PaymentMode).order_by(PaymentMode.is_builtin.desc(), PaymentMode.id)
    if active_only:
        query = query.where(PaymentMode.active)
    modes = (await db.execute(query)).scalars().all()
    counts = await payment_counts(db)
    return [mode_out(mode, counts) for mode in modes]


async def get_mode_or_404(db: AsyncSession, mode_id: int) -> PaymentMode:
    mode = await db.get(PaymentMode, mode_id)
    if mode is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payment mode not found.")
    return mode


async def check_mode_name_free(db: AsyncSession, name: str, ignore_id: int | None) -> None:
    clash = await db.scalar(
        select(PaymentMode.id).where(
            PaymentMode.name_norm == norm_sql(name), PaymentMode.id != (ignore_id or 0)
        )
    )
    if clash is not None:
        raise conflict(MODE_NAME_TAKEN)


def mode_snapshot(mode: PaymentMode) -> dict[str, Any]:
    return {
        "type": mode.type,
        "name": mode.name,
        "details": mode.details,
        "use_salary": mode.use_salary,
        "use_advance": mode.use_advance,
        "active": mode.active,
    }


async def _audit_mode(
    db: AsyncSession,
    actor: User,
    action: str,
    mode: PaymentMode,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> None:
    await record_audit(
        db,
        module="admin",
        action=action,
        entity="payment_mode",
        entity_id=mode.id,
        user_id=actor.id,
        data={"before": before, "after": after},
    )


async def create_payment_mode(db: AsyncSession, actor: User, data: PaymentModeIn) -> PaymentMode:
    await check_mode_name_free(db, data.name, None)
    mode = PaymentMode(
        type=data.type,
        name=data.name,
        details=data.details,
        use_salary=data.use_salary,
        use_advance=data.use_advance,
        active=True,
        is_builtin=False,
    )
    db.add(mode)
    await db.flush()
    await _audit_mode(db, actor, "create", mode, None, mode_snapshot(mode))
    await db.commit()
    await db.refresh(mode)
    return mode


async def update_payment_mode(
    db: AsyncSession, actor: User, mode: PaymentMode, data: PaymentModeIn
) -> PaymentMode:
    if mode.is_builtin:
        raise conflict(CASH_LOCKED)
    await check_mode_name_free(db, data.name, mode.id)
    before = mode_snapshot(mode)
    mode.type = data.type
    mode.name = data.name
    mode.details = data.details
    mode.use_salary = data.use_salary
    mode.use_advance = data.use_advance
    await db.flush()
    after = mode_snapshot(mode)
    if after != before:
        await _audit_mode(db, actor, "update", mode, before, after)
    await db.commit()
    await db.refresh(mode)
    return mode


async def set_payment_mode_active(
    db: AsyncSession, actor: User, mode: PaymentMode, active: bool
) -> PaymentMode:
    if mode.is_builtin and not active:
        raise conflict(CASH_ALWAYS_ON)
    if mode.active == active:
        return mode
    before = mode_snapshot(mode)
    mode.active = active
    await db.flush()
    await _audit_mode(
        db, actor, "activate" if active else "deactivate", mode, before, mode_snapshot(mode)
    )
    await db.commit()
    await db.refresh(mode)
    return mode
