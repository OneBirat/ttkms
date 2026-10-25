"""The month report, one employee's month (the phone attendance calendar) and the marked-day
dots. Cells: P / O / A from records, ``W`` for a Saturday without a record, ``N`` not marked;
payment badges come from payroll's ``PayrollPayments.for_month`` (payments counting for the
month, shown on the day they were paid)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import PaymentRecord, get_payroll_payments
from app.core import bsdate
from app.core.models import Department, Employee, EmployeeStatus
from app.modules.attendance import schemas, services
from app.modules.attendance.access import Scope, one_branch
from app.modules.attendance.models import Record


def month_or_404(bs_year: int, bs_month: int) -> tuple[date, date]:
    """AD range of a BS month that is not in the future (404 otherwise)."""
    try:
        start, end = bsdate.bs_month_range(bs_year, bs_month)
    except (ValueError, KeyError):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"No month {bs_year}-{bs_month:02d}."
        ) from None
    if start > services.today():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="That month has not started yet.")
    return start, end


def month_ref(bs_year: int, bs_month: int) -> schemas.BsMonthRef:
    start, end = bsdate.bs_month_range(bs_year, bs_month)
    days = [services.day_header(start + timedelta(days=i)) for i in range((end - start).days + 1)]
    name_np = bsdate.bs_month_name(bs_month, "ne")
    return schemas.BsMonthRef(
        bs_year=bs_year,
        bs_month=bs_month,
        label=f"{bsdate.bs_month_name(bs_month)} {bs_year}",
        label_np=f"{name_np} {bsdate.to_nepali_digits(bs_year)}",
        key=f"{bs_year:04d}-{bs_month:02d}",
        ad_start=start,
        ad_end=end,
        days=days,
        working_days=sum(1 for d in days if not d.is_weekly_off),
    )


def payments_by_day(payments: Iterable[PaymentRecord]) -> dict[date, dict[str, int]]:
    out: dict[date, dict[str, int]] = defaultdict(lambda: {"advance": 0, "salary": 0})
    for p in payments:
        out[p.date][p.kind] += p.amount
    return out


def cells_for(
    days: Sequence[schemas.DayHeader],
    records: dict[date, Record],
    paid: dict[date, dict[str, int]],
    joined: date,
) -> list[schemas.DayCell]:
    cells = []
    for day in days:
        record = records.get(day.ad_date)
        if record is not None:
            cell = schemas.DayCell(status=record.status, ot_hours=record.overtime_hours)
        elif day.is_weekly_off and day.ad_date >= joined:
            cell = schemas.DayCell(status="W")
        else:
            cell = schemas.DayCell(status="N")
        money = paid.get(day.ad_date)
        if money:
            cell.advance = money["advance"] or None
            cell.salary = money["salary"] or None
        cells.append(cell)
    return cells


def totals_of(
    days: Sequence[schemas.DayHeader], cells: Sequence[schemas.DayCell]
) -> schemas.AttendanceTotals:
    t = schemas.AttendanceTotals()
    for day, cell in zip(days, cells, strict=True):
        if cell.status == "P":
            t.present += 1
        elif cell.status == "O":
            t.overtime_days += 1
            t.overtime_hours += cell.ot_hours
        elif cell.status == "A":
            t.absent += 1
        elif cell.status == "W":
            t.weekly_off += 1
        else:
            t.not_marked += 1
        if day.is_weekly_off and cell.status in ("P", "O"):
            t.saturday_days_worked += 1
            t.saturday_ot_hours += cell.ot_hours
    t.marked_days = t.present + t.overtime_days + t.absent
    t.attended = t.present + t.overtime_days
    t.paid_days = t.present + t.overtime_days + t.weekly_off
    return t


async def month_records(
    db: AsyncSession, start: date, end: date, employee_ids: Iterable[int], branch_id: int | None
) -> dict[int, dict[date, Record]]:
    ids = list(employee_ids)
    out: dict[int, dict[date, Record]] = defaultdict(dict)
    if not ids:
        return out
    query = select(Record).where(
        Record.employee_id.in_(ids), Record.date >= start, Record.date <= end
    )
    if branch_id is not None:
        query = query.where(Record.branch_id == branch_id)
    for r in await db.scalars(query):
        out[r.employee_id][r.date] = r
    return out


def payment_out(p: PaymentRecord) -> schemas.PaymentOut:
    return schemas.PaymentOut(**asdict(p))


async def report_employees(
    db: AsyncSession, branch_id: int | None, start: date, end: date
) -> list[Employee]:
    """Who belongs in a month's report: everyone of the branch who had joined by the month's end
    and was still active at its start (inactive staff stay in past months), plus anyone with a
    mark in the branch that month (moved since)."""
    window_start = datetime.combine(start, datetime.min.time(), tzinfo=bsdate.KATHMANDU)
    query = select(Employee).where(
        Employee.joined_ad <= end,
        or_(
            Employee.status == EmployeeStatus.active,
            Employee.deactivated_at.is_(None),
            Employee.deactivated_at >= window_start,
        ),
    )
    if branch_id is not None:
        moved = select(Record.employee_id).where(
            Record.branch_id == branch_id, Record.date >= start, Record.date <= end
        )
        query = query.where(or_(Employee.branch_id == branch_id, Employee.id.in_(moved)))
    return sorted(await db.scalars(query), key=services.sort_key)


async def month_report(
    db: AsyncSession, scope: Scope, bs_year: int, bs_month: int
) -> schemas.MonthReport:
    start, end = month_or_404(bs_year, bs_month)
    month = month_ref(bs_year, bs_month)
    branch_id = scope.branch_id
    employees = await report_employees(db, branch_id, start, end)
    ids = [e.id for e in employees]
    records = await month_records(db, start, end, ids, branch_id)
    payments = await get_payroll_payments().for_month(bs_year, bs_month, ids)
    rows = []
    for e in employees:
        cells = cells_for(
            month.days, records.get(e.id, {}), payments_by_day(payments.get(e.id, [])), e.joined_ad
        )
        rows.append(
            schemas.ReportRow(
                employee=services.employee_ref(e), cells=cells, totals=totals_of(month.days, cells)
            )
        )
    departments = list(await db.scalars(select(Department)))
    return schemas.MonthReport(
        month=month,
        settings=services.SETTINGS,
        branch_id=branch_id,
        branches=await services.branch_refs(db, scope),
        departments=services.department_refs(departments, employees),
        rows=rows,
        staff_present=[
            sum(1 for row in rows if row.cells[i].status in ("P", "O"))
            for i in range(len(month.days))
        ],
        today=services.today(),
        generated_at=datetime.now(UTC),
    )


async def employee_month(
    db: AsyncSession, scope: Scope, employee_id: int, bs_year: int, bs_month: int
) -> schemas.EmployeeMonth:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise services.not_found("No such employee.")
    if not scope.allows(employee.branch_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This employee is in another branch.")
    start, end = month_or_404(bs_year, bs_month)
    month = month_ref(bs_year, bs_month)
    records = (await month_records(db, start, end, [employee.id], None)).get(employee.id, {})
    payments = (await get_payroll_payments().for_month(bs_year, bs_month, [employee.id])).get(
        employee.id, []
    )
    cells = cells_for(month.days, records, payments_by_day(payments), employee.joined_ad)
    return schemas.EmployeeMonth(
        employee=services.employee_ref(employee),
        month=month,
        cells=cells,
        totals=totals_of(month.days, cells),
        payments=[
            payment_out(p)
            for p in sorted(payments, key=lambda p: (p.date, p.payment_id), reverse=True)
        ],
    )


async def marked_days(
    db: AsyncSession, scope: Scope, bs_year: int, bs_month: int, employee_id: int | None
) -> schemas.MarkedDays:
    try:
        start, end = bsdate.bs_month_range(bs_year, bs_month)
    except (ValueError, KeyError):
        raise services.not_found(f"No month {bs_year}-{bs_month:02d}.") from None
    query = select(Record.date).where(Record.date >= start, Record.date <= end).distinct()
    if employee_id is not None:
        employee = await db.get(Employee, employee_id)
        if employee is None or not scope.allows(employee.branch_id):
            raise services.not_found("No such employee.")
        query = query.where(Record.employee_id == employee_id)
    else:
        query = query.where(Record.branch_id == await one_branch(db, scope))
    days = sorted(await db.scalars(query))
    return schemas.MarkedDays(
        bs_year=bs_year, bs_month=bs_month, marked_days=[services.bs_of(d) for d in days]
    )
