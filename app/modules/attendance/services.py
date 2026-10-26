"""Marking: the day list, mark / change / clear one person, bulk Present, and the audit trail.

Rules (docs/attendance-backend-plan.md): P / O (+ whole hours 1-12) / A only; not marked = no
row; Saturday is the weekly off - computed, never stored, so a Saturday row means the person came
in (P or O; A is refused). The attendance day is an AD date in Asia/Kathmandu and future days are
never writable. Only active employees can be marked; every write lands in ``record_changes``.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import get_payroll_payments
from app.core import bsdate
from app.core.errors import ApiError
from app.core.media import photo_urls
from app.core.models import Branch, Department, Employee, EmployeeStatus, User
from app.core.modules import is_enabled
from app.modules.attendance import schemas
from app.modules.attendance.access import Scope, one_branch
from app.modules.attendance.models import OT_MAX, OT_MIN, Record, RecordChange, Source

#: Saturday (0 = Sunday ... 6 = Saturday). The rule is fixed: Saturday is the weekly off.
WEEKLY_OFF = 6
SETTINGS = schemas.AttendanceSettings(weekly_off=WEEKLY_OFF)


# --------------------------------------------------------------------------------- clock


def now() -> datetime:
    """The current instant (``bsdate.utc_now``; tests also replace this to sit on either side
    of Kathmandu midnight)."""
    return bsdate.utc_now()


def today() -> date:
    """Today's attendance day: the AD calendar date in Asia/Kathmandu."""
    return bsdate.today_ad(now())


# -------------------------------------------------------------------------------- errors


def invalid(detail: str, field: str) -> ApiError:
    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, "invalid", field=field)


def not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=detail)


# ---------------------------------------------------------------------------------- days


def is_weekly_off(ad: date) -> bool:
    return bsdate.weekday_index(ad) == WEEKLY_OFF


def parse_day(date_bs: str, field: str = "date_bs") -> date:
    try:
        return bsdate.parse_bs(date_bs).to_ad()
    except ValueError:
        raise invalid(f"{date_bs} is not a valid BS date.", field) from None


def check_not_future(ad: date, field: str = "date_bs") -> None:
    if ad > today():
        raise invalid("Attendance cannot be marked for a future day.", field)


def bs_of(ad: date) -> str:
    return bsdate.ad_to_bs(ad).isoformat()


def day_header(ad: date) -> schemas.DayHeader:
    bs = bsdate.ad_to_bs(ad)
    return schemas.DayHeader(
        bs_date=bs.isoformat(),
        bs_day=bs.day,
        ad_date=ad,
        weekday=bsdate.weekday_index(ad),
        is_weekly_off=is_weekly_off(ad),
    )


# ---------------------------------------------------------------------------------- output


def employee_ref(e: Employee) -> schemas.EmployeeRef:
    return schemas.EmployeeRef(
        id=e.id,
        code=e.code,
        barcode=e.barcode,
        name=e.full_name,
        name_ne=e.full_name_np,
        branch_id=e.branch_id,
        branch_name=e.branch.name if e.branch else "",
        department_id=e.department_id or 0,
        department_name=e.department.name if e.department else "",
        designation=e.designation,
        photo_url=photo_urls(e)[1] if is_enabled("payroll") else None,
        active=e.status == EmployeeStatus.active,
    )


async def usernames(db: AsyncSession, records: Iterable[Record]) -> dict[int, str]:
    ids = {r.marked_by for r in records if r.marked_by}
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.username).where(User.id.in_(ids)))
    return dict(rows.all())


def record_out(r: Record, names: dict[int, str]) -> schemas.AttendanceRecord:
    return schemas.AttendanceRecord(
        employee_id=r.employee_id,
        date_bs=bs_of(r.date),
        date_ad=r.date,
        status=r.status,
        ot_hours=r.overtime_hours,
        note=r.note,
        marked_by=names.get(r.marked_by or 0, ""),
        marked_via=r.source,
        updated_at=r.marked_at,
    )


async def records_out(
    db: AsyncSession, records: Sequence[Record]
) -> list[schemas.AttendanceRecord]:
    names = await usernames(db, records)
    return [record_out(r, names) for r in records]


# ------------------------------------------------------------------------------- employees


def active_in_branch(branch_id: int):
    return select(Employee).where(
        Employee.branch_id == branch_id, Employee.status == EmployeeStatus.active
    )


async def employee_to_mark(db: AsyncSession, scope: Scope, employee_id: int) -> Employee:
    """The active employee, visible to the caller: 404 unknown / inactive, 403 other branch."""
    employee = await db.get(Employee, employee_id)
    if employee is None or employee.status != EmployeeStatus.active:
        raise not_found("No active employee with that id.")
    if not scope.allows(employee.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This employee is in another branch.")
    return employee


def check_mark(employee: Employee, ad: date, status_: str, hours: int) -> None:
    if status_ == "O":
        if not OT_MIN <= hours <= OT_MAX:
            raise invalid(f"Overtime needs {OT_MIN}–{OT_MAX} whole hours.", "ot_hours")
    elif hours:
        raise invalid("Only overtime (O) carries hours.", "ot_hours")
    if status_ == "A" and is_weekly_off(ad):
        raise invalid(
            "Saturday is the weekly off: mark only staff who came in (P or O), or clear the mark.",
            "status",
        )
    if ad < employee.joined_ad:
        raise invalid(
            f"{employee.full_name} joined on {bs_of(employee.joined_ad)}; "
            "days before that cannot be marked.",
            "date_bs",
        )


# ---------------------------------------------------------------------------------- audit


def change_row(
    record: Record | None,
    employee_id: int,
    ad: date,
    old: tuple[str | None, int, str],
    user: User | None,
    source: str,
) -> RecordChange:
    old_status, old_hours, old_note = old
    return RecordChange(
        record_id=record.id if record else None,
        employee_id=employee_id,
        date=ad,
        old_status=old_status,
        new_status=record.status if record else None,
        old_hours=old_hours,
        new_hours=record.overtime_hours if record else 0,
        old_note=old_note,
        new_note=record.note if record else "",
        source=source,
        changed_by=user.id if user else None,
    )


# ---------------------------------------------------------------------------------- writes


async def upsert(
    db: AsyncSession,
    user: User | None,
    employee: Employee,
    ad: date,
    status_: str,
    hours: int,
    note: str | None,
    source: Source,
) -> tuple[Record, str]:
    """Insert or update the day's record (row-locked); returns it and the previous status ("N"
    when there was none). Writes an audit row when anything changed. The caller commits."""
    check_mark(employee, ad, status_, hours)
    existing = await db.scalar(
        select(Record).where(Record.employee_id == employee.id, Record.date == ad).with_for_update()
    )
    if existing is None:
        # ON CONFLICT DO NOTHING: a concurrent insert for the same day wins, we then update it.
        new_id = await db.scalar(
            insert(Record)
            .values(
                employee_id=employee.id,
                date=ad,
                status=status_,
                overtime_hours=hours,
                branch_id=employee.branch_id,
                source=source.value,
                marked_by=user.id if user else None,
                note=note or "",
            )
            .on_conflict_do_nothing(index_elements=["employee_id", "date"])
            .returning(Record.id)
        )
        if new_id is not None:
            record = await db.get(Record, new_id)
            assert record is not None
            db.add(change_row(record, employee.id, ad, (None, 0, ""), user, source.value))
            await db.flush()
            return record, "N"
        existing = await db.scalar(
            select(Record)
            .where(Record.employee_id == employee.id, Record.date == ad)
            .with_for_update()
        )
        assert existing is not None
    old = (existing.status, existing.overtime_hours, existing.note)
    new_note = existing.note if note is None else note
    if old != (status_, hours, new_note):
        existing.status = status_
        existing.overtime_hours = hours
        existing.note = new_note
        existing.source = source.value
        existing.marked_by = user.id if user else None
        existing.marked_at = func.now()
        await db.flush()
        await db.refresh(existing)
        db.add(change_row(existing, employee.id, ad, old, user, source.value))
        await db.flush()
    return existing, old[0]


async def mark_one(
    db: AsyncSession, user: User, scope: Scope, body: schemas.MarkOneRequest
) -> schemas.MarkOneResponse:
    ad = parse_day(body.date_bs)
    check_not_future(ad)
    employee = await employee_to_mark(db, scope, body.employee_id)
    note = " ".join(body.note.split()) if body.note is not None else None
    record, previous = await upsert(
        db, user, employee, ad, body.status, body.ot_hours, note, Source.manual
    )
    out = (await records_out(db, [record]))[0]
    await db.commit()
    return schemas.MarkOneResponse(date=ad, date_bs=bs_of(ad), record=out, previous=previous)


async def clear_mark(
    db: AsyncSession, user: User, scope: Scope, employee_id: int, date_bs: str
) -> schemas.ClearMarkResponse:
    """Back to "not marked" (the weekly off again on a Saturday). Idempotent."""
    ad = parse_day(date_bs)
    check_not_future(ad)
    employee = await employee_to_mark(db, scope, employee_id)
    record = await db.scalar(
        select(Record).where(Record.employee_id == employee.id, Record.date == ad).with_for_update()
    )
    previous = "N"
    if record is not None:
        previous = record.status
        db.add(
            change_row(
                None,
                employee.id,
                ad,
                (record.status, record.overtime_hours, record.note),
                user,
                Source.manual.value,
            )
        )
        await db.execute(delete(Record).where(Record.id == record.id))
        await db.commit()
    return schemas.ClearMarkResponse(
        date=ad,
        date_bs=bs_of(ad),
        employee_id=employee.id,
        previous=previous,
        now="W" if is_weekly_off(ad) else "N",
    )


async def bulk_present(
    db: AsyncSession, user: User, scope: Scope, body: schemas.BulkMarkRequest
) -> schemas.BulkMarkResponse:
    """Present for every active employee of the scope still unmarked that day - one transaction,
    ``INSERT ... ON CONFLICT DO NOTHING``, so a mark made meanwhile is never overwritten."""
    ad = parse_day(body.date_bs)
    check_not_future(ad)
    if body.employee_ids is None and body.department_id is None:
        raise invalid("Give employee_ids or a department_id.", "employee_ids")
    if is_weekly_off(ad):
        raise invalid(
            "Saturday is the weekly off: mark only the staff who came in, one by one.", "date_bs"
        )
    branch_id = body.branch_id if scope.any_branch else await one_branch(db, scope)
    query = active_in_branch(branch_id).where(Employee.joined_ad <= ad)
    if body.department_id is not None:
        query = query.where(Employee.department_id == body.department_id)
    if body.employee_ids is not None:
        query = query.where(Employee.id.in_(body.employee_ids or [0]))
    employees = list(await db.scalars(query.order_by(Employee.full_name, Employee.id)))
    inserted: dict[int, int] = {}
    if employees:
        rows = await db.execute(
            insert(Record)
            .values(
                [
                    {
                        "employee_id": e.id,
                        "date": ad,
                        "status": "P",
                        "overtime_hours": 0,
                        "branch_id": e.branch_id,
                        "source": Source.bulk.value,
                        "marked_by": user.id,
                        "note": "",
                    }
                    for e in employees
                ]
            )
            .on_conflict_do_nothing(index_elements=["employee_id", "date"])
            .returning(Record.employee_id, Record.id)
        )
        inserted = dict(rows.all())
    records = (
        list(await db.scalars(select(Record).where(Record.id.in_(inserted.values()))))
        if inserted
        else []
    )
    for record in records:
        db.add(change_row(record, record.employee_id, ad, (None, 0, ""), user, Source.bulk.value))
    out = await records_out(db, sorted(records, key=lambda r: r.employee_id))
    await db.commit()
    return schemas.BulkMarkResponse(
        date=ad,
        date_bs=bs_of(ad),
        marked=[
            schemas.MarkedName(employee_id=e.id, name=e.full_name)
            for e in employees
            if e.id in inserted
        ],
        skipped=[e.id for e in employees if e.id not in inserted],
        records=out,
    )


# ----------------------------------------------------------------------------- day list


async def branch_refs(db: AsyncSession, scope: Scope) -> list[schemas.BranchRef]:
    counts = dict(
        (
            await db.execute(
                select(Employee.branch_id, func.count())
                .where(Employee.status == EmployeeStatus.active)
                .group_by(Employee.branch_id)
            )
        ).all()
    )
    query = select(Branch).order_by(Branch.name)
    if not scope.any_branch:
        query = query.where(Branch.id == (scope.branch_id or 0))
    return [
        schemas.BranchRef(id=b.id, name=b.name, headcount=counts.get(b.id, 0))
        for b in await db.scalars(query)
        if b.is_active or counts.get(b.id) or b.id == scope.branch_id
    ]


def department_refs(
    departments: Sequence[Department], employees: Iterable[Employee]
) -> list[schemas.DepartmentRef]:
    counts: dict[int, int] = defaultdict(int)
    for e in employees:
        if e.department_id:
            counts[e.department_id] += 1
    return [
        schemas.DepartmentRef(id=d.id, name=d.name, headcount=counts[d.id])
        for d in sorted(departments, key=lambda d: d.name.lower())
        if counts.get(d.id)
    ]


async def day_records(db: AsyncSession, ad: date, employee_ids: Iterable[int]) -> dict[int, Record]:
    ids = list(employee_ids)
    if not ids:
        return {}
    rows = await db.scalars(select(Record).where(Record.date == ad, Record.employee_id.in_(ids)))
    return {r.employee_id: r for r in rows}


async def payments_on(ad: date, employee_ids: Sequence[int]) -> dict[int, schemas.PaymentFlags]:
    """Rupees paid on ``ad`` per employee (payroll contract; a salary paid today may count for
    the previous month, so both months are asked)."""
    if not employee_ids:
        return {}
    bs = bsdate.ad_to_bs(ad)
    flags: dict[int, schemas.PaymentFlags] = {}
    payroll = get_payroll_payments()
    for year, month in ((bs.year, bs.month), bsdate.shift_month(bs.year, bs.month, -1)):
        for employee_id, payments in (await payroll.for_month(year, month, employee_ids)).items():
            for p in payments:
                if p.date != ad:
                    continue
                f = flags.setdefault(employee_id, schemas.PaymentFlags())
                if p.kind == "advance":
                    f.advance += p.amount
                else:
                    f.salary += p.amount
    return flags


def sort_key(e: Employee) -> tuple[str, str, int]:
    return ((e.department.name if e.department else "~").lower(), e.full_name.lower(), e.id)


async def day_rows(
    db: AsyncSession, branch_id: int, ad: date
) -> list[tuple[Employee, Record | None]]:
    """Every active employee of the branch (joined by ``ad``) with that day's record."""
    employees = sorted(
        await db.scalars(active_in_branch(branch_id).where(Employee.joined_ad <= ad)), key=sort_key
    )
    records = await day_records(db, ad, [e.id for e in employees])
    return [(e, records.get(e.id)) for e in employees]


async def day_attendance(
    db: AsyncSession, scope: Scope, date_bs: str, department_id: int | None, *, money: bool = True
) -> schemas.DayAttendance:
    """``money`` = salary_advances: only then do rows carry today's payment flags."""
    ad = parse_day(date_bs)
    check_not_future(ad)
    branch_id = await one_branch(db, scope)
    rows = await day_rows(db, branch_id, ad)
    departments = list(await db.scalars(select(Department)))
    dept_refs = department_refs(departments, (e for e, _ in rows))
    if department_id is not None:
        rows = [(e, r) for e, r in rows if (e.department_id or 0) == department_id]
    names = await usernames(db, [r for _, r in rows if r])
    flags = await payments_on(ad, [e.id for e, _ in rows]) if money else {}
    return schemas.DayAttendance(
        date=ad,
        date_bs=bs_of(ad),
        day=day_header(ad),
        settings=SETTINGS,
        branches=await branch_refs(db, scope),
        departments=dept_refs,
        rows=[
            schemas.MarkRow(
                employee=employee_ref(e),
                record=record_out(r, names) if r else None,
                payments_today=flags.get(e.id),
            )
            for e, r in rows
        ],
    )


# ------------------------------------------------------------------------------------ scan


async def lookup(db: AsyncSession, scope: Scope, employee_id: int) -> schemas.LookupResponse:
    """Today's state of a scanned employee (the browser resolves the sticker through payroll's
    ``/api/payroll/employees/by-barcode/{code}`` first)."""
    employee = await employee_to_mark(db, scope, employee_id)
    ad = today()
    record = (await day_records(db, ad, [employee.id])).get(employee.id)
    return schemas.LookupResponse(
        date=ad,
        date_bs=bs_of(ad),
        code=employee.barcode,
        employee=employee_ref(employee),
        today=(await records_out(db, [record]))[0] if record else None,
    )


async def scan_mark(
    db: AsyncSession, user: User, scope: Scope, body: schemas.ScanRequest
) -> schemas.ScanResponse:
    """Present or overtime for today, saved at once (``source = scan``)."""
    employee = await employee_to_mark(db, scope, body.employee_id)
    ad = today()
    overtime = body.action == "overtime"
    record, previous = await upsert(
        db,
        user,
        employee,
        ad,
        "O" if overtime else "P",
        body.ot_hours if overtime else 0,
        None,
        Source.scan,
    )
    out = (await records_out(db, [record]))[0]
    await db.commit()
    return schemas.ScanResponse(
        date=ad, date_bs=bs_of(ad), employee=employee_ref(employee), record=out, previous=previous
    )
