"""Payments: balance, recording with the caps the brief sets, the register, the account screens.

Caps (server-side, whatever the UI says): an advance always targets the running BS month and
may not exceed ``earned so far - already paid for the month``; a salary payment targets the
running month (same cap) or a past month (cap = its balance due), never a future one. The mode
must be active and allowed for the kind.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import get_attendance_summary
from app.core import bsdate
from app.core.models import Branch, Department, Employee, EmployeeStatus, User
from app.core.services import record_audit
from app.modules.admin.models import PaymentMode
from app.modules.payroll import ledgers, services
from app.modules.payroll.ledgers import MonthLedger
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource
from app.modules.payroll.reports import ledger_out, month_label, payment_out
from app.modules.payroll.schemas import (
    AccountSummaryOut,
    BranchRef,
    BsMonthOut,
    DepartmentRef,
    EmployeeLedgerOut,
    EmployeeMonthAttendanceOut,
    LedgerEntryOut,
    LedgerTotalsOut,
    MonthBalanceOut,
    MonthLedgerOut,
    MonthSummaryOut,
    PaymentIn,
    PaymentOut,
    PaymentResultOut,
    PaymentsRegisterOut,
    RegisterBranchTotalOut,
    RegisterDepartmentTotalOut,
    RegisterEmployeeTotalOut,
    RegisterRowOut,
    RegisterSort,
    RegisterTotalsOut,
)

MODULE = "payroll"
RECEIPT_PREFIX = {"salary": "SAL", "advance": "ADV"}


def month_out(year: int, month: int) -> BsMonthOut:
    return BsMonthOut(bs_year=year, bs_month=month)


async def employee_data(db: AsyncSession, employee: Employee):
    structures = (await ledgers.load_structures(db, [employee.id])).get(employee.id, [])
    payments = (await ledgers.load_payments(db, [employee.id])).get(employee.id, [])
    return structures, payments


async def month_ledger_or_404(
    db: AsyncSession, employee: Employee, year: int, month: int
) -> tuple[MonthLedger, list, list]:
    structures, payments = await employee_data(db, employee)
    ledger = await ledgers.ledger_for(employee, year, month, structures, payments)
    if ledger is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="No salary for this month (before the joining date)."
        )
    return ledger, structures, payments


def balance_out(ledger: MonthLedger) -> MonthBalanceOut:
    return MonthBalanceOut(
        employee_id=ledger.employee.id,
        for_year=ledger.year,
        for_month=ledger.month,
        month_key=f"{ledger.year}-{ledger.month:02d}",
        month_label=month_label(ledger.year, ledger.month),
        earned=ledger.net,
        paid=ledger.paid,
        due=ledger.due,
        status=ledger.settled.status,
        breakdown={
            "gross_salary": ledger.pay.gross_salary,
            "overtime_pay": ledger.pay.overtime_pay,
            "absence_deduction": ledger.pay.absence_deduction,
            "tds": ledger.pay.tds,
            "salary_paid": ledger.settled.salary_paid,
            "advance_paid": ledger.settled.advance_paid,
            "in_progress": ledger.in_progress,
        },
    )


async def balance(db: AsyncSession, employee: Employee, year: int, month: int) -> MonthBalanceOut:
    ledger, _, _ = await month_ledger_or_404(db, employee, year, month)
    return balance_out(ledger)


# -------------------------------------------------------------------------- recording


@dataclass(frozen=True)
class Caps:
    cap: int
    running: bool


def cap_for(ledger: MonthLedger, kind: str) -> Caps:
    current = ledgers.current_month()
    running = (ledger.year, ledger.month) == current
    if ledgers.month_index(ledger.year, ledger.month) > ledgers.month_index(*current):
        raise services.invalid("That month has not started yet.", "for_month")
    if kind == "advance" and not running:
        raise services.invalid("Advances go against the running month.", "for_month")
    # Running month: earned so far - paid. Past month: the balance due. Both are ledger.due.
    return Caps(cap=ledger.due, running=running)


async def next_receipt_no(db: AsyncSession, kind: str) -> str:
    seq = "receipt_sal_seq" if kind == "salary" else "receipt_adv_seq"
    value = await db.scalar(text(f"SELECT nextval('payroll.{seq}')"))
    return f"{RECEIPT_PREFIX[kind]}-{int(value):04d}"


async def check_mode(db: AsyncSession, mode_id: int | None, kind: str) -> PaymentMode:
    mode = await db.get(PaymentMode, mode_id or services.CASH_MODE_ID)
    if mode is None:
        raise services.invalid("Choose a payment mode.", "payment_mode_id")
    if not mode.active:
        raise services.invalid(f"{mode.name} is switched off.", "payment_mode_id")
    if kind == "salary" and not mode.use_salary:
        raise services.invalid(f"{mode.name} is not set up for salary payments.", "payment_mode_id")
    if kind == "advance" and not mode.use_advance:
        raise services.invalid(f"{mode.name} is not set up for advances.", "payment_mode_id")
    return mode


def resolve_day(data: PaymentIn) -> date:
    today = bsdate.today_ad()
    if data.date_bs is not None:
        day = bsdate.bs_to_ad(data.date_bs)
        if data.date is not None and data.date != day:
            raise services.invalid("date and date_bs are different days.", "date_bs")
    elif data.date is not None:
        day = data.date
    else:
        day = today
    if day > today:
        raise services.invalid("The payment date cannot be in the future.", "date_bs")
    return day


async def record_payment(
    db: AsyncSession, actor: User | None, employee: Employee, data: PaymentIn
) -> PaymentResultOut:
    if employee.status != EmployeeStatus.active:
        raise services.invalid("This employee is no longer active.", "employee_id")
    if data.amount <= 0:
        raise services.invalid("Enter an amount above 0.", "amount")
    ledger, _, _ = await month_ledger_or_404(db, employee, data.for_year, data.for_month)
    caps = cap_for(ledger, data.kind)
    if data.amount > caps.cap:
        label = month_label(ledger.year, ledger.month)
        detail = (
            f"More than can be given now for {label} (Rs {caps.cap:,} earned so far and unpaid)."
            if caps.running
            else f"More than the balance due for {label} (Rs {caps.cap:,})."
        )
        raise services.ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail,
            "over_room" if caps.running else "over_due",
            field="amount",
            cap=caps.cap,
        )
    mode = await check_mode(db, data.payment_mode_id, data.kind)
    day = resolve_day(data)
    payment = Payment(
        receipt_no=await next_receipt_no(db, data.kind),
        employee_id=employee.id,
        kind=PaymentKind(data.kind),
        for_year=data.for_year,
        for_month=data.for_month,
        amount=data.amount,
        payment_mode_id=mode.id,
        date=day,
        reference=None if mode.type == "cash" else data.reference,
        note=data.note,
        source=PaymentSource(data.source),
        recorded_by=actor.id if actor else None,
    )
    db.add(payment)
    await db.flush()
    await record_audit(
        db,
        module=MODULE,
        action="pay",
        entity="payment",
        entity_id=payment.id,
        user_id=actor.id if actor else None,
        data={
            "after": {
                "receipt_no": payment.receipt_no,
                "employee_id": employee.id,
                "kind": data.kind,
                "for_year": data.for_year,
                "for_month": data.for_month,
                "amount": data.amount,
                "payment_mode_id": mode.id,
                "date": day.isoformat(),
                "source": data.source,
            }
        },
    )
    await db.commit()
    await db.refresh(payment)
    modes = await services.modes_by_id(db)
    return PaymentResultOut(
        payment=payment_out(payment, modes), due_after=max(0, caps.cap - data.amount)
    )


# --------------------------------------------------------------------------- register


def _sort_key(sort: RegisterSort, all_branches: bool):
    def dept(row: RegisterRowOut) -> tuple[int, str]:
        d = row.employee.department
        return (0, d.name.lower()) if d else (1, "")

    def branch(row: RegisterRowOut) -> tuple[str, int]:
        return (row.employee.branch.name.lower(), row.employee.branch.id)

    def date_desc(row: RegisterRowOut) -> tuple[date, int]:
        return (row.payment.date.ad, row.payment.id)

    if sort == "branch":
        return lambda r: (branch(r), dept(r)), False
    if sort == "department":
        return (lambda r: (branch(r) if all_branches else ("", 0), dept(r))), False
    if sort == "employee":
        return lambda r: (r.employee.full_name.lower(), r.employee.id), False
    if sort == "amount":
        return lambda r: (-r.payment.amount, -r.payment.date.ad.toordinal(), -r.payment.id), False
    return date_desc, True


def sort_rows(
    rows: list[RegisterRowOut], sort: RegisterSort, all_branches: bool
) -> list[RegisterRowOut]:
    if sort == "date":
        return sorted(rows, key=lambda r: (r.payment.date.ad, r.payment.id), reverse=True)
    key, _ = _sort_key(sort, all_branches)
    # Stable: newest first inside every group.
    newest_first = sorted(rows, key=lambda r: (r.payment.date.ad, r.payment.id), reverse=True)
    return sorted(newest_first, key=key)


async def settlement_month(rows: Sequence[MonthLedger | None]) -> tuple[int, int]:
    """Previous BS month while any employee still owes for it, else the running month."""
    year, month = ledgers.current_month()
    previous = bsdate.shift_month(year, month, -1)
    any_due = any(ledger is not None and ledger.due > 0 for ledger in rows)
    return previous if any_due else (year, month)


def totals_of(rows: Sequence[RegisterRowOut]) -> tuple[int, int, int]:
    salary = sum(r.payment.amount for r in rows if r.payment.kind == "salary")
    advances = sum(r.payment.amount for r in rows if r.payment.kind == "advance")
    return salary, advances, salary + advances


async def register(
    db: AsyncSession,
    scope: services.Scope,
    *,
    from_bs: bsdate.BSDate | None,
    to_bs: bsdate.BSDate | None,
    kind: str | None,
    employee_id: int | None,
    department_id: int | None,
    sort: RegisterSort,
) -> PaymentsRegisterOut:
    start = bsdate.bs_to_ad(from_bs) if from_bs else None
    end = bsdate.bs_to_ad(to_bs) if to_bs else None
    if start and end and start > end:
        raise services.invalid('"From" is after "To" - swap the dates.', "from")
    department = await db.get(Department, department_id) if department_id is not None else None
    if department_id is not None and department is None:
        raise services.not_found("No such department.")
    branch = await db.get(Branch, scope.branch_id) if scope.branch_id else None

    employees_q = select(Employee).order_by(Employee.full_name, Employee.id)
    if scope.branch_id is not None:
        employees_q = employees_q.where(Employee.branch_id == scope.branch_id)
    employees = list(await db.scalars(employees_q))
    by_id = {e.id: e for e in employees}
    logins = await services.logins_for(db, list(by_id))
    modes = await services.modes_by_id(db)
    emp_out = {e.id: services.employee_out(e, logins.get(e.id)) for e in employees}

    query = select(Payment).where(Payment.employee_id.in_(list(by_id) or [0]))
    if start:
        query = query.where(Payment.date >= start)
    if end:
        query = query.where(Payment.date <= end)
    if kind in ("salary", "advance"):
        query = query.where(Payment.kind == PaymentKind(kind))
    if employee_id:
        query = query.where(Payment.employee_id == employee_id)
    in_range = [
        RegisterRowOut(payment=payment_out(p, modes), employee=emp_out[p.employee_id])
        for p in await db.scalars(query.order_by(Payment.date, Payment.id))
    ]
    # Chips: every department of the scope, over the whole range (not the chosen department).
    departments = list(await db.scalars(select(Department).order_by(Department.name)))
    by_department = []
    for d in [*departments, None]:
        mine = [
            r
            for r in in_range
            if (r.employee.department.id if r.employee.department else None)
            == (d.id if d else None)
        ]
        if d is None and not mine:
            continue
        salary, advances, total = totals_of(mine)
        by_department.append(
            RegisterDepartmentTotalOut(
                department=DepartmentRef(id=d.id, name=d.name) if d else None,
                count=len(mine),
                salary=salary,
                advances=advances,
                total=total,
            )
        )
    branches = list(await db.scalars(select(Branch).order_by(Branch.name, Branch.id)))
    by_branch = []
    for b in branches:
        if branch and b.id != branch.id:
            continue
        mine = [r for r in in_range if r.employee.branch.id == b.id]
        if not mine:
            continue
        salary, advances, total = totals_of(mine)
        by_branch.append(
            RegisterBranchTotalOut(
                branch=BranchRef(id=b.id, name=b.name, is_active=b.is_active),
                count=len(mine),
                salary=salary,
                advances=advances,
                total=total,
            )
        )
    rows = [
        r
        for r in in_range
        if department is None
        or (r.employee.department and r.employee.department.id == department.id)
    ]
    rows = sort_rows(rows, sort, branch is None)

    # Tiles and By employee: the settlement month, for the scoped (branch + department) staff.
    scoped = [e for e in employees if department is None or e.department_id == department.id]
    ids = [e.id for e in scoped]
    structures = await ledgers.load_structures(db, ids)
    all_payments = await ledgers.load_payments(db, ids)
    year, month = ledgers.current_month()
    previous = bsdate.shift_month(year, month, -1)
    prev_ledgers = [
        await ledgers.ledger_for(e, *previous, structures.get(e.id, []), all_payments.get(e.id, []))
        for e in scoped
        if e.status == EmployeeStatus.active
    ]
    settle_month = await settlement_month(prev_ledgers)
    month_ledgers = [
        await ledgers.ledger_for(
            e, *settle_month, structures.get(e.id, []), all_payments.get(e.id, [])
        )
        for e in scoped
        if e.status == EmployeeStatus.active
    ]
    month_ledgers = [ledger for ledger in month_ledgers if ledger is not None]
    by_employee = [
        RegisterEmployeeTotalOut(
            employee=emp_out[ledger.employee.id],
            net=ledger.net,
            advance_paid=ledger.settled.advance_paid,
            salary_paid=ledger.settled.salary_paid,
            paid=ledger.paid,
            due=ledger.due,
        )
        for ledger in month_ledgers
    ]
    return PaymentsRegisterOut(
        from_bs=from_bs.isoformat() if from_bs else "",
        to_bs=to_bs.isoformat() if to_bs else "",
        branch=BranchRef(id=branch.id, name=branch.name, is_active=branch.is_active)
        if branch
        else None,
        department=DepartmentRef(id=department.id, name=department.name) if department else None,
        sort=sort,
        rows=rows,
        totals=RegisterTotalsOut(
            month=month_out(*settle_month),
            staff=len(month_ledgers),
            month_net=sum(ledger.net for ledger in month_ledgers),
            salary_paid=sum(ledger.settled.salary_paid for ledger in month_ledgers),
            advance_paid=sum(ledger.settled.advance_paid for ledger in month_ledgers),
            due=sum(ledger.due for ledger in month_ledgers),
            count=len(rows),
            amount=sum(r.payment.amount for r in rows),
        ),
        by_employee=by_employee,
        by_department=by_department,
        by_branch=by_branch,
    )


async def recent_payments(
    db: AsyncSession, employee: Employee, limit: int = 20
) -> list[PaymentOut]:
    modes = await services.modes_by_id(db)
    rows = await db.scalars(
        select(Payment)
        .where(Payment.employee_id == employee.id)
        .order_by(Payment.date.desc(), Payment.id.desc())
        .limit(limit)
    )
    return [payment_out(p, modes) for p in rows]


async def get_payment(db: AsyncSession, payment_id: int) -> Payment:
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise services.not_found("No such payment.")
    return payment


# ------------------------------------------------------------------------------ account


async def month_ledgers(db: AsyncSession, employee: Employee) -> list[MonthLedgerOut]:
    structures, payments = await employee_data(db, employee)
    modes = await services.modes_by_id(db)
    rows = await ledgers.ledgers_kept(employee, structures, payments)
    return [ledger_out(ledger, modes) for ledger in reversed(rows)]


async def month_ledger(
    db: AsyncSession, employee: Employee, year: int, month: int
) -> MonthLedgerOut:
    ledger, _, _ = await month_ledger_or_404(db, employee, year, month)
    return ledger_out(ledger, await services.modes_by_id(db))


async def attendance_month(employee: Employee, year: int, month: int) -> EmployeeMonthAttendanceOut:
    s = await get_attendance_summary().for_month(employee.id, year, month)
    return EmployeeMonthAttendanceOut(
        employee_id=employee.id,
        month=month_out(year, month),
        summary=MonthSummaryOut(
            days_in_month=s.days_in_month,
            present=s.present,
            overtime_days=s.overtime_days,
            overtime_hours=s.overtime_hours,
            absent=s.absent,
            weekly_off=s.weekly_off,
            paid_days=s.paid_days,
        ),
    )


def _rs(value: int) -> str:
    return f"{value:,}"


async def transactions(db: AsyncSession, employee: Employee) -> EmployeeLedgerOut:
    structures, payments = await employee_data(db, employee)
    modes = await services.modes_by_id(db)
    months = await ledgers.ledgers_kept(employee, structures, payments)
    today = bsdate.today_ad()
    entries: list[LedgerEntryOut] = []
    for ledger in months:
        earned_on = today if ledger.in_progress else ledger.ends
        so_far = " · so far" if ledger.in_progress else ""
        key = f"{ledger.year}-{ledger.month:02d}"
        m = month_out(ledger.year, ledger.month)
        pay_type = ledger.structure.pay_type.value
        entries.append(
            LedgerEntryOut(
                id=f"{key}-salary",
                date=services.date_both(earned_on),
                month=m,
                type="salary",
                details=(
                    f"Monthly salary · {ledger.attendance.days_in_month} days{so_far}"
                    if pay_type == "monthly"
                    else f"Daily wage {_rs(ledger.rate)} × {ledger.pay.paid_days} days{so_far}"
                ),
                earned=ledger.pay.gross_salary,
                paid=0,
                balance=0,
                payment=None,
                in_progress=ledger.in_progress,
            )
        )
        if ledger.pay.absence_deduction > 0:
            per_day = (
                round(ledger.rate / ledger.attendance.days_in_month)
                if ledger.attendance.days_in_month
                else 0
            )
            entries.append(
                LedgerEntryOut(
                    id=f"{key}-absence",
                    date=services.date_both(earned_on),
                    month=m,
                    type="absence",
                    details=f"{ledger.attendance.absent} day(s) × Rs {_rs(per_day)}",
                    earned=-ledger.pay.absence_deduction,
                    paid=0,
                    balance=0,
                    payment=None,
                    in_progress=ledger.in_progress,
                )
            )
        if ledger.pay.overtime_pay > 0:
            entries.append(
                LedgerEntryOut(
                    id=f"{key}-overtime",
                    date=services.date_both(earned_on),
                    month=m,
                    type="overtime",
                    details=(
                        f"{ledger.attendance.overtime_hours} h × Rs {_rs(ledger.structure.ot_rate)}"
                    ),
                    earned=ledger.pay.overtime_pay,
                    paid=0,
                    balance=0,
                    payment=None,
                    in_progress=ledger.in_progress,
                )
            )
        for p in ledger.payments:
            out = payment_out(p, modes)
            details = out.payment_mode.name
            if out.reference:
                details += f" · {out.reference}"
            if out.note:
                details += f" · {out.note}"
            details += f" · by {out.recorded_by or 'system'}"
            entries.append(
                LedgerEntryOut(
                    id=f"pay-{p.id}",
                    date=out.date,
                    month=m,
                    type="advance" if p.kind == PaymentKind.advance else "salary_paid",
                    details=details,
                    earned=0,
                    paid=p.amount,
                    balance=0,
                    payment=out,
                    in_progress=False,
                )
            )
    order = {"salary": 0, "absence": 1, "overtime": 2, "advance": 3, "salary_paid": 4}
    entries.sort(key=lambda e: (e.date.ad, order[e.type], e.payment.id if e.payment else 0))
    running = 0
    for entry in entries:
        running += entry.earned - entry.paid
        entry.balance = running
    advances = [e for e in entries if e.type == "advance"]
    salary_payments = [e for e in entries if e.type == "salary_paid"]
    return EmployeeLedgerOut(
        employee_id=employee.id,
        entries=entries,
        totals=LedgerTotalsOut(
            salary=sum(e.earned for e in entries if e.type in ("salary", "absence")),
            overtime=sum(e.earned for e in entries if e.type == "overtime"),
            overtime_hours=sum(ledger.attendance.overtime_hours for ledger in months),
            months=len(months),
            advances=sum(e.paid for e in advances),
            advance_count=len(advances),
            salary_payments=sum(e.paid for e in salary_payments),
            salary_payment_count=len(salary_payments),
            balance=sum(ledger.due for ledger in months),
        ),
    )


async def account_summary(db: AsyncSession, employee: Employee) -> AccountSummaryOut:
    structures, payments = await employee_data(db, employee)
    modes = await services.modes_by_id(db)
    year, month = ledgers.current_month()
    running = await ledgers.ledger_for(employee, year, month, structures, payments)
    months = await ledgers.ledgers_kept(employee, structures, payments)
    previous = bsdate.shift_month(year, month, -1)
    prev = await ledgers.ledger_for(employee, *previous, structures, payments)
    salary_month = previous if prev is not None and prev.due > 0 else (year, month)
    salary_row = prev if salary_month == previous else running
    recent = sorted(payments, key=lambda p: (p.date, p.id), reverse=True)
    four_ago = ledgers.month_index(*bsdate.shift_month(year, month, -3))
    earned = running.net if running else 0
    paid = running.paid if running else 0
    return AccountSummaryOut(
        employee_id=employee.id,
        month=month_out(year, month),
        earned_so_far=earned,
        paid_this_month=paid,
        room=max(0, earned - paid),
        salary_month=month_out(*salary_month),
        salary_net=salary_row.net if salary_row else 0,
        salary_paid=salary_row.paid if salary_row else 0,
        salary_due=salary_row.due if salary_row else 0,
        recent=[payment_out(p, modes) for p in recent],
        advances_recent=sum(
            p.amount
            for p in recent
            if p.kind == PaymentKind.advance
            and ledgers.month_index(p.for_year, p.for_month) >= four_ago
        ),
        balance_due=sum(ledger.due for ledger in months),
        overtime_hours_this_month=running.attendance.overtime_hours if running else 0,
    )


async def months_with_data(db: AsyncSession) -> list[BsMonthOut]:
    """The kept window, newest first (what the report's month select offers)."""
    return [month_out(*m) for m in reversed(ledgers.months_kept())]
