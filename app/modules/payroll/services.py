"""Employees (core.employees + payroll.salary_history) behind /api/payroll/employees."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import get_attendance_summary
from app.core import bsdate
from app.core.auth import hash_password
from app.core.errors import ApiError
from app.core.media import photo_urls
from app.core.models import (
    PHONE_RE,
    Branch,
    Department,
    Employee,
    EmployeeStatus,
    Role,
    User,
    normalize_phone,
    normalize_username,
)
from app.core.services import record_audit
from app.modules.admin.models import PaymentMode, UserAccess
from app.modules.admin.permissions import access_for_user, branch_scope
from app.modules.admin.services import generate_temporary_password
from app.modules.payroll import ledgers, rules
from app.modules.payroll.models import PayType, SalaryHistory
from app.modules.payroll.schemas import (
    BranchRef,
    DateBothOut,
    DepartmentRef,
    EmployeeIn,
    EmployeeListRowOut,
    EmployeeOut,
    EmployeeUpdateIn,
    LoginOut,
    PaymentModeRef,
    SalaryRevisionIn,
    SalaryStructureOut,
    SalaryStructuresOut,
)

CASH_MODE_ID = 1
MODULE = "payroll"


def invalid(detail: str, field: str) -> ApiError:
    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, "invalid", field=field)


def conflict(detail: str, field: str, code: str = "duplicate") -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, detail, code, field=field)


def not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=detail)


# ------------------------------------------------------------------------------ scoping


@dataclass(frozen=True)
class Scope:
    """The ONE branch the caller works on (``admin.permissions.branch_scope``: the active branch,
    or an explicit one with ``see_other_branches``; 0 = nothing for a user without a branch).
    Never "every branch". ``locked`` = may not switch (forced to their own branch)."""

    branch_id: int
    locked: bool
    #: ``salary_advances``: whether money fields may be shown.
    money: bool

    def allows(self, branch_id: int) -> bool:
        return self.branch_id == branch_id


async def scope_for(db: AsyncSession, user: User, requested: int | None) -> Scope:
    access = await access_for_user(db, user)
    scope = await branch_scope(db, user, requested)
    return Scope(scope.branch_id, not scope.can_switch, bool(access.get("salary_advances")))


def ensure_visible(scope: Scope, employee: Employee) -> None:
    """Single-employee endpoints follow the active branch too: one branch for the whole app."""
    if not scope.allows(employee.branch_id):
        where = employee.branch.name if employee.branch else "another branch"
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"{employee.full_name} is in {where}. Switch to that branch to open them.",
        )


# ------------------------------------------------------------------------------- output


def date_both(ad) -> DateBothOut:
    return DateBothOut(bs=bsdate.ad_to_bs(ad).isoformat(), ad=ad)


def photo_url(employee: Employee) -> str | None:
    """The 600 px photo (profile, barcode views); see photo_thumb_url for lists."""
    return photo_urls(employee)[0]


def photo_thumb_url(employee: Employee) -> str | None:
    """The 128 px thumbnail (lists, side strip, avatars, attendance cards)."""
    return photo_urls(employee)[1]


def employee_out(employee: Employee, login: User | None) -> EmployeeOut:
    return EmployeeOut(
        id=employee.id,
        code=employee.code,
        barcode=employee.barcode,
        full_name=employee.full_name,
        full_name_np=employee.full_name_np,
        phone=employee.phone,
        phone_alt=employee.phone_alt,
        address=employee.address,
        branch=BranchRef(
            id=employee.branch.id, name=employee.branch.name, is_active=employee.branch.is_active
        ),
        department=DepartmentRef(id=employee.department.id, name=employee.department.name)
        if employee.department
        else None,
        designation=employee.designation,
        active=employee.status == EmployeeStatus.active,
        joined=date_both(employee.joined_ad),
        photo_url=photo_url(employee),
        photo_thumb_url=photo_thumb_url(employee),
        login=LoginOut(
            user_id=login.id, username=login.username, role=login.role, role_label=login.role_label
        )
        if login
        else None,
        created_at=employee.created_at,
    )


async def logins_for(db: AsyncSession, employee_ids: list[int]) -> dict[int, User]:
    if not employee_ids:
        return {}
    rows = await db.scalars(select(User).where(User.employee_id.in_(employee_ids)))
    return {u.employee_id: u for u in rows if u.employee_id is not None}


_PHONE_LIKE = re.compile(r"^\+?[\d\s-]{7,}$")


def user_label(user: User | None) -> str:
    """How a user is named on payments ("Recorded by", "Voided by", "Printed by"): the full name,
    else the linked employee's name, else the username - never a raw phone number ("" for none)."""
    if user is None:
        return ""
    candidates = [user.full_name, user.employee.full_name if user.employee else None, user.username]
    for name in candidates:
        name = (name or "").strip()
        if name and not _PHONE_LIKE.match(name) and name != user.phone:
            return name
    return f"User {user.id}"


async def modes_by_id(db: AsyncSession) -> dict[int, PaymentMode]:
    return {m.id: m for m in await db.scalars(select(PaymentMode))}


def mode_ref(mode: PaymentMode) -> PaymentModeRef:
    return PaymentModeRef(id=mode.id, type=mode.type, name=mode.name)


# ---------------------------------------------------------------------------- employees


async def get_employee(db: AsyncSession, employee_id: int) -> Employee:
    # A SELECT (not identity-map get) so branch / department are loaded even for an object the
    # session already holds from an add() without a refresh.
    employee = await db.scalar(
        select(Employee).where(Employee.id == employee_id).execution_options(populate_existing=True)
    )
    if employee is None:
        raise not_found("No such employee.")
    return employee


def normalize_barcode(raw: str) -> str | None:
    """``"TTK-E001"``, ``"TTK-E-001"`` (legacy stickers), ``"ttk e001"``, ``"E-001"`` and bare
    digits -> ``"TTK-E001"``."""
    value = re.sub(r"\s+", "", raw).upper()
    match = re.fullmatch(r"(?:TTK-?)?(?:E-?)?(\d{1,6})", value)
    if not match:
        return None
    return f"TTK-E{match.group(1).zfill(3)}"


async def employee_by_barcode(db: AsyncSession, raw: str) -> Employee:
    barcode = normalize_barcode(raw)
    employee = (
        await db.scalar(
            select(Employee).where(
                Employee.barcode == barcode, Employee.status == EmployeeStatus.active
            )
        )
        if barcode
        else None
    )
    if employee is None:
        raise not_found(f"No active employee for barcode {raw.strip() or '(empty)'}.")
    return employee


async def list_rows(
    db: AsyncSession,
    scope: Scope,
    *,
    q: str | None,
    department_id: int | None,
    active: bool | None,
) -> list[EmployeeListRowOut]:
    query = select(Employee).order_by(Employee.full_name, Employee.id)
    if scope.branch_id is not None:
        query = query.where(Employee.branch_id == scope.branch_id)
    if department_id is not None:
        query = query.where(Employee.department_id == department_id)
    if active is not None:
        query = query.where(
            Employee.status == (EmployeeStatus.active if active else EmployeeStatus.inactive)
        )
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            Employee.full_name.ilike(like) | Employee.code.ilike(like) | Employee.phone.ilike(like)
        )
    employees = list(await db.scalars(query))
    ids = [e.id for e in employees]
    logins = await logins_for(db, ids)
    today = await get_attendance_summary().today(ids)
    structures = await ledgers.load_structures(db, ids) if scope.money else {}
    payments = await ledgers.load_payments(db, ids, ledgers.months_kept()) if scope.money else {}
    rows: list[EmployeeListRowOut] = []
    year, month = ledgers.current_month()
    rule = await ledgers.saturday_rule(db)
    for employee in employees:
        pay_type = rate = due = None
        if scope.money:
            structure = ledgers.structure_for(structures.get(employee.id, []), year, month)
            if structure is not None:
                pay_type = structure.pay_type.value
                rate = ledgers.rate_of(structure)
            due = await ledgers.balance_due(
                employee,
                structures.get(employee.id, []),
                payments.get(employee.id, []),
                saturday_rule=rule,
            )
        rows.append(
            EmployeeListRowOut(
                employee=employee_out(employee, logins.get(employee.id)),
                pay_type=pay_type,
                rate=rate,
                today=today.get(employee.id, "not_marked"),
                balance_due=due,
            )
        )
    return rows


async def next_code(db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT last_value, is_called FROM core.employee_code_seq"))).one()
    n = int(row[0]) + 1 if row[1] else int(row[0])
    return f"E-{str(n).zfill(max(3, len(str(n))))}"


def barcode_of(code: str) -> str:
    return f"TTK-{code.replace('-', '')}"


async def _check_phone(db: AsyncSession, raw: str, except_id: int | None) -> str:
    phone = normalize_phone(raw)
    if not PHONE_RE.match(phone):
        raise invalid("Enter a 10-digit mobile number starting with 97 or 98.", "phone")
    other = await db.scalar(
        select(Employee).where(
            Employee.phone == phone,
            Employee.status == EmployeeStatus.active,
            Employee.id != (except_id or 0),
        )
    )
    if other is not None:
        raise conflict(
            f"{other.full_name} ({other.code}) already has this number.", "phone", "duplicate_phone"
        )
    return phone


async def _check_refs(
    db: AsyncSession, branch_id: int, department_id: int
) -> tuple[Branch, Department]:
    branch = await db.get(Branch, branch_id)
    if branch is None or not branch.is_active:
        raise invalid("Choose a branch.", "branch_id")
    department = await db.get(Department, department_id)
    if department is None:
        raise invalid("Choose a department.", "department_id")
    return branch, department


async def _check_mode(db: AsyncSession, mode_id: int | None) -> int:
    mode = await db.get(PaymentMode, mode_id or CASH_MODE_ID)
    if mode is None or not mode.active:
        raise invalid("Choose an active payment mode.", "default_payment_mode_id")
    return mode.id


def snapshot(employee: Employee) -> dict[str, Any]:
    return {
        "code": employee.code,
        "full_name": employee.full_name,
        "full_name_np": employee.full_name_np,
        "phone": employee.phone,
        "phone_alt": employee.phone_alt,
        "address": employee.address,
        "branch_id": employee.branch_id,
        "department_id": employee.department_id,
        "designation": employee.designation,
        "status": employee.status.value,
        "joined_ad": employee.joined_ad.isoformat(),
    }


async def _audit(db, actor: User, action: str, entity: str, entity_id: int, before, after) -> None:
    await record_audit(
        db,
        module=MODULE,
        action=action,
        entity=entity,
        entity_id=entity_id,
        user_id=actor.id,
        data={"before": before, "after": after},
    )


async def create_employee(
    db: AsyncSession, actor: User, data: EmployeeIn
) -> tuple[Employee, User | None, str | None]:
    phone = await _check_phone(db, data.phone, None)
    branch, department = await _check_refs(db, data.branch_id, data.department_id)
    mode_id = await _check_mode(db, data.default_payment_mode_id)
    joined_ad = bsdate.bs_to_ad(data.joined_bs) if data.joined_bs else bsdate.today_ad()
    if joined_ad > bsdate.today_ad():
        raise invalid("The joining date cannot be in the future.", "joined_bs")
    login: User | None = None
    temporary: str | None = None
    if data.login:
        username = normalize_username(data.login.username)
        if await db.scalar(select(User).where(User.username == username)):
            raise conflict("This username is taken.", "username", "duplicate_username")
    employee = Employee(
        full_name=data.full_name,
        full_name_np=data.full_name_np,
        phone=phone,
        phone_alt=data.phone_alt,
        address=data.address,
        branch_id=branch.id,
        department_id=department.id,
        designation=data.designation,
        joined_ad=joined_ad,
    )
    db.add(employee)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise conflict(
            "Another active employee already has this number.", "phone", "duplicate_phone"
        ) from None
    await db.refresh(employee)
    db.add(
        SalaryHistory(
            employee_id=employee.id,
            pay_type=PayType(data.pay_type),
            basic=data.amount,
            allowances=0,
            ot_rate=rules.default_ot_rate(data.pay_type, data.amount),
            default_payment_mode_id=mode_id,
            effective_ad=joined_ad,
            created_by=actor.id,
        )
    )
    if data.login:
        temporary = generate_temporary_password()
        phone_free = await db.scalar(select(User).where(User.phone == phone)) is None
        login = User(
            username=normalize_username(data.login.username),
            phone=phone if phone_free else None,
            password_hash=hash_password(temporary),
            full_name=data.full_name,
            role=data.login.role,
            is_active=True,
            must_change_password=True,
            employee_id=employee.id,
        )
        db.add(login)
        await db.flush()
        db.add(
            UserAccess(
                user_id=login.id,
                branch_id=None if login.role == Role.admin else branch.id,
                access=None,
            )
        )
    await db.flush()
    await _audit(db, actor, "create", "employee", employee.id, None, snapshot(employee))
    if data.photo_data_url:
        from app.modules.payroll import photos

        await db.flush()
        await photos.store_photo(db, actor, employee, photos.decode_data_url(data.photo_data_url))
    await db.commit()
    await db.refresh(employee)
    return employee, login, temporary


async def update_employee(
    db: AsyncSession, actor: User, employee: Employee, data: EmployeeUpdateIn
) -> Employee:
    before = snapshot(employee)
    phone = (
        await _check_phone(db, data.phone, employee.id)
        if data.active
        else normalize_phone(data.phone)
    )
    branch, department = await _check_refs(db, data.branch_id, data.department_id)
    joined_ad = bsdate.bs_to_ad(data.joined_bs)
    if joined_ad > bsdate.today_ad():
        raise invalid("The joining date cannot be in the future.", "joined_bs")
    employee.full_name = data.full_name
    employee.full_name_np = data.full_name_np
    employee.phone = phone
    employee.phone_alt = data.phone_alt
    employee.address = data.address
    employee.branch_id = branch.id
    employee.department_id = department.id
    employee.designation = data.designation
    employee.joined_ad = joined_ad
    _set_active(employee, data.active)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise conflict(
            "Another active employee already has this number.", "phone", "duplicate_phone"
        ) from None
    await db.refresh(employee)
    after = snapshot(employee)
    if after != before:
        await _audit(db, actor, "update", "employee", employee.id, before, after)
        await db.commit()
    return employee


def _set_active(employee: Employee, active: bool) -> None:
    if active and employee.status != EmployeeStatus.active:
        employee.status = EmployeeStatus.active
        employee.deactivated_at = None
    elif not active and employee.status == EmployeeStatus.active:
        employee.status = EmployeeStatus.inactive
        employee.deactivated_at = datetime.now(UTC)


async def deactivate_employee(db: AsyncSession, actor: User, employee: Employee) -> Employee:
    if employee.status == EmployeeStatus.active:
        before = snapshot(employee)
        _set_active(employee, False)
        await db.flush()
        await _audit(db, actor, "deactivate", "employee", employee.id, before, snapshot(employee))
        await db.commit()
        await db.refresh(employee)
    return employee


# ------------------------------------------------------------------------------- salary


def structure_out(
    row: SalaryHistory, modes: dict[int, PaymentMode], previous: SalaryHistory | None
) -> SalaryStructureOut:
    mode = modes[row.default_payment_mode_id or CASH_MODE_ID]
    return SalaryStructureOut(
        id=row.id,
        employee_id=row.employee_id,
        pay_type=row.pay_type.value,
        basic=row.basic,
        allowances=row.allowances,
        gross=row.basic + row.allowances,
        ot_rate=row.ot_rate,
        default_payment_mode_id=mode.id,
        default_payment_mode=mode_ref(mode),
        effective_from=date_both(row.effective_ad),
        reason=row.reason,
        previous_gross=previous.basic + previous.allowances if previous else None,
    )


async def salary_structures(db: AsyncSession, employee: Employee) -> SalaryStructuresOut:
    rows = list(
        await db.scalars(
            select(SalaryHistory)
            .where(SalaryHistory.employee_id == employee.id)
            .order_by(SalaryHistory.effective_ad, SalaryHistory.id)
        )
    )
    modes = await modes_by_id(db)
    outs = [structure_out(row, modes, rows[i - 1] if i else None) for i, row in enumerate(rows)]
    outs.reverse()
    return SalaryStructuresOut(current=outs[0] if outs else None, history=outs)


async def revise_salary(
    db: AsyncSession, actor: User, employee: Employee, data: SalaryRevisionIn
) -> SalaryStructureOut:
    effective_ad = bsdate.bs_to_ad(data.effective_from_bs)
    if effective_ad < employee.joined_ad:
        raise invalid("The revision cannot start before the joining date.", "effective_from_bs")
    mode_id = await _check_mode(db, data.default_payment_mode_id)
    amount = data.basic + data.allowances if data.pay_type == "monthly" else data.basic
    row = SalaryHistory(
        employee_id=employee.id,
        pay_type=PayType(data.pay_type),
        basic=data.basic,
        allowances=data.allowances if data.pay_type == "monthly" else 0,
        ot_rate=data.ot_rate
        if data.ot_rate is not None
        else rules.default_ot_rate(data.pay_type, amount),
        default_payment_mode_id=mode_id,
        effective_ad=effective_ad,
        reason=data.reason,
        created_by=actor.id,
    )
    db.add(row)
    await db.flush()
    previous = await db.scalar(
        select(SalaryHistory)
        .where(SalaryHistory.employee_id == employee.id, SalaryHistory.id != row.id)
        .order_by(SalaryHistory.effective_ad.desc(), SalaryHistory.id.desc())
        .limit(1)
    )
    await _audit(
        db,
        actor,
        "revise",
        "salary",
        employee.id,
        {"gross": previous.basic + previous.allowances, "pay_type": previous.pay_type.value}
        if previous
        else None,
        {
            "gross": row.basic + row.allowances,
            "pay_type": row.pay_type.value,
            "ot_rate": row.ot_rate,
            "effective_ad": effective_ad.isoformat(),
        },
    )
    await db.commit()
    return structure_out(row, await modes_by_id(db), previous)


async def count_active(db: AsyncSession) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Employee)
            .where(Employee.status == EmployeeStatus.active)
        )
        or 0
    )
