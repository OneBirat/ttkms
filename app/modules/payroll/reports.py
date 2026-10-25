"""The salary report for one BS month: rows per employee (derived ledgers), totals, per
department / per branch summaries and the net-payroll trend. Scoped server-side."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import bsdate
from app.core.models import Branch, Department, Employee, EmployeeStatus, User
from app.modules.admin.models import PaymentMode
from app.modules.payroll import ledgers, services
from app.modules.payroll.models import Payment
from app.modules.payroll.schemas import (
    BranchNetTotalOut,
    BranchRef,
    BsMonthOut,
    DepartmentNetTotalOut,
    DepartmentRef,
    MonthLedgerOut,
    MonthNetTotalOut,
    MonthSummaryOut,
    PaymentOut,
    ReportRowOut,
    ReportTotalsOut,
    SalaryReportOut,
)

TREND_MONTHS = 5


def month_label(year: int, month: int) -> str:
    return f"{bsdate.bs_month_name(month)} {year}"


def parse_month_key(key: str) -> tuple[int, int]:
    """``"2083-07"`` -> ``(2083, 7)``; 422 otherwise."""
    parts = key.split("-")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit() and 1 <= int(parts[1]) <= 12:
        return int(parts[0]), int(parts[1])
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Month must be YYYY-MM (BS).")


def payment_out(p: Payment, modes: dict[int, PaymentMode]) -> PaymentOut:
    mode = modes[p.payment_mode_id]
    return PaymentOut(
        id=p.id,
        receipt_no=p.receipt_no,
        employee_id=p.employee_id,
        kind=p.kind.value,
        for_year=p.for_year,
        for_month=p.for_month,
        month=BsMonthOut(bs_year=p.for_year, bs_month=p.for_month),
        amount=p.amount,
        payment_mode_id=p.payment_mode_id,
        payment_mode=services.mode_ref(mode),
        reference=p.reference,
        note=p.note,
        date=services.date_both(p.date),
        paid_at=p.paid_at,
        recorded_by=services.user_label(p.recorder),
        source=p.source.value,
        created_at=p.created_at,
        payment_group_id=p.payment_group_id,
        voided=p.voided_at is not None,
        voided_at=p.voided_at,
        voided_by=services.user_label(p.voider) if p.voided_at else None,
        void_reason=p.void_reason,
    )


def ledger_out(ledger: ledgers.MonthLedger, modes: dict[int, PaymentMode]) -> MonthLedgerOut:
    a = ledger.attendance
    pay = ledger.pay
    s = ledger.settled
    return MonthLedgerOut(
        employee_id=ledger.employee.id,
        month=BsMonthOut(bs_year=ledger.year, bs_month=ledger.month),
        starts=services.date_both(ledger.starts),
        ends=services.date_both(ledger.ends),
        in_progress=ledger.in_progress,
        pay_type=ledger.structure.pay_type.value,
        rate=ledger.rate,
        ot_rate=ledger.structure.ot_rate,
        attendance=MonthSummaryOut(
            **asdict(a),
        ),
        paid_days=pay.paid_days,
        gross_salary=pay.gross_salary,
        overtime_pay=pay.overtime_pay,
        earnings=pay.earnings,
        absence_deduction=pay.absence_deduction,
        tds=pay.tds,
        net=pay.net,
        saturday_pay=pay.saturday_pay,
        salary_paid=s.salary_paid,
        advance_paid=s.advance_paid,
        paid=s.paid,
        due=s.due,
        status=s.status,
        cleared_on=services.date_both(ledger.cleared_on) if ledger.cleared_on else None,
        # Voided ones are listed too (struck through), never in salary_paid / paid / due.
        payments=[
            payment_out(p, modes)
            for p in sorted([*ledger.payments, *ledger.voided], key=lambda p: (p.date, p.id))
        ],
    )


def totals_for(rows: Iterable[ledgers.MonthLedger]) -> ReportTotalsOut:
    rows = list(rows)
    return ReportTotalsOut(
        staff=len(rows),
        gross=sum(r.pay.earnings for r in rows),
        absence_deduction=sum(r.pay.absence_deduction for r in rows),
        absent_days=sum(r.attendance.absent for r in rows),
        overtime_pay=sum(r.pay.overtime_pay for r in rows),
        overtime_hours=sum(
            r.attendance.overtime_hours + r.attendance.saturday_ot_hours for r in rows
        ),
        advance_paid=sum(r.settled.advance_paid for r in rows),
        salary_paid=sum(r.settled.salary_paid for r in rows),
        tds=sum(r.pay.tds for r in rows),
        net=sum(r.pay.net for r in rows),
        due=sum(r.settled.due for r in rows),
        paid_count=sum(1 for r in rows if r.settled.status == "paid"),
        part_paid_count=sum(1 for r in rows if r.settled.status == "part_paid"),
        pending_count=sum(1 for r in rows if r.settled.status == "pending"),
    )


@dataclass
class ReportData:
    """The computed report plus the ledgers behind it (the exports need both)."""

    out: SalaryReportOut
    ledgers: list[ledgers.MonthLedger]
    title: str


def branch_ref(branch: Branch) -> BranchRef:
    return BranchRef(id=branch.id, name=branch.name, is_active=branch.is_active)


async def scoped_employees(db: AsyncSession, scope: services.Scope) -> list[Employee]:
    query = select(Employee).order_by(Employee.full_name, Employee.id)
    if scope.branch_id is not None:
        query = query.where(Employee.branch_id == scope.branch_id)
    return list(await db.scalars(query))


async def salary_report(
    db: AsyncSession,
    scope: services.Scope,
    year: int,
    month: int,
    department_id: int | None,
) -> ReportData:
    current = ledgers.current_month()
    if ledgers.month_index(year, month) > ledgers.month_index(*current):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="That month has not started yet.")
    department = await db.get(Department, department_id) if department_id is not None else None
    if department_id is not None and department is None:
        raise services.not_found("No such department.")
    branch = await db.get(Branch, scope.branch_id) if scope.branch_id else None

    employees = await scoped_employees(db, scope)
    ids = [e.id for e in employees]
    structures = await ledgers.load_structures(db, ids)
    payments = await ledgers.load_payments(db, ids)
    modes = await services.modes_by_id(db)
    logins = await services.logins_for(db, ids)
    rule = await ledgers.saturday_rule(db)

    # Active staff, plus former staff who still have a payment for that month.
    def on_sheet(e: Employee) -> bool:
        if e.status == EmployeeStatus.active:
            return True
        return any(p.for_year == year and p.for_month == month for p in payments.get(e.id, []))

    all_rows: list[ledgers.MonthLedger] = []
    for e in employees:
        if not on_sheet(e):
            continue
        ledger = await ledgers.ledger_for(
            e, year, month, structures.get(e.id, []), payments.get(e.id, []), saturday_rule=rule
        )
        if ledger is not None:
            all_rows.append(ledger)
    rows = [r for r in all_rows if department is None or r.employee.department_id == department.id]

    departments = list(await db.scalars(select(Department).order_by(Department.name)))
    by_department = [
        DepartmentNetTotalOut(
            department=DepartmentRef(id=d.id, name=d.name),
            staff=sum(1 for r in all_rows if r.employee.department_id == d.id),
            net=sum(r.net for r in all_rows if r.employee.department_id == d.id),
        )
        for d in departments
    ]
    branches = list(await db.scalars(select(Branch).order_by(Branch.name, Branch.id)))
    by_branch = [
        BranchNetTotalOut(
            branch=branch_ref(b),
            staff=sum(1 for r in rows if r.employee.branch_id == b.id),
            net=sum(r.net for r in rows if r.employee.branch_id == b.id),
            paid=sum(r.paid for r in rows if r.employee.branch_id == b.id),
            due=sum(r.due for r in rows if r.employee.branch_id == b.id),
        )
        for b in branches
        if branch is None or b.id == branch.id
    ]
    by_branch = [b for b in by_branch if b.staff > 0]

    trend: list[MonthNetTotalOut] = []
    for k in range(TREND_MONTHS - 1, -1, -1):
        ty, tm = bsdate.shift_month(year, month, -k)
        net = 0
        for e in employees:
            if department is not None and e.department_id != department.id:
                continue
            if not on_sheet(e) and e.status != EmployeeStatus.active:
                continue
            ledger = await ledgers.ledger_for(
                e, ty, tm, structures.get(e.id, []), payments.get(e.id, []), saturday_rule=rule
            )
            net += ledger.net if ledger else 0
        trend.append(MonthNetTotalOut(month=BsMonthOut(bs_year=ty, bs_month=tm), net=net))

    scope_text = branch.name if branch else "All branches"
    title_parts = [
        "Salary report",
        scope_text,
        department.name if department else None,
        month_label(year, month),
    ]
    out = SalaryReportOut(
        month=BsMonthOut(bs_year=year, bs_month=month),
        branch=branch_ref(branch) if branch else None,
        department=DepartmentRef(id=department.id, name=department.name) if department else None,
        rows=[
            ReportRowOut(
                employee=services.employee_out(r.employee, logins.get(r.employee.id)),
                ledger=ledger_out(r, modes),
            )
            for r in rows
        ],
        totals=totals_for(rows),
        by_department=by_department,
        by_branch=by_branch,
        trend=trend,
        all_staff=len(all_rows),
    )
    return ReportData(out=out, ledgers=rows, title=" · ".join(p for p in title_parts if p))


def slug(text: str) -> str:
    import re

    return re.sub(r"[^\w]+", "-", text.lower()).strip("-")


def report_file_stem(data: ReportData) -> str:
    out = data.out
    scope = out.branch.name if out.branch else "all-branches"
    dept = f"-{slug(out.department.name)}" if out.department else ""
    return f"salary-{out.month.bs_year}-{out.month.bs_month:02d}-{slug(scope)}{dept}"


def printed_by(user: User) -> str:
    return services.user_label(user)


def sum_of(rows: Sequence[ledgers.MonthLedger], pick) -> int:
    return sum(pick(r) for r in rows)
