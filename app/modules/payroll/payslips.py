"""Pay slips for the Salary report's batch printing: GET /api/payroll/payslips.

Nothing is computed here: every slip is built from the :class:`ledgers.MonthLedger` behind the
employee's Salary report row (``reports.salary_report``), so a slip and the report can never
disagree. Only the split of the absence deduction per reason (``rules.split_deduction``) and
the per-day rate (``rules.day_rate``) are added, both in rules.py."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import bsdate
from app.core.models import Branch, Employee, User
from app.core.services import company_name
from app.modules.admin.models import PaymentMode
from app.modules.payroll import ledgers, reports, rules, services, slip_prints
from app.modules.payroll.schemas import (
    BsMonthOut,
    PayslipDeductionOut,
    PayslipEmployeeOut,
    PayslipMonthOut,
    PayslipOut,
    PayslipPaymentOut,
    PayslipPrintedOut,
    PayslipsOut,
)

IDS = "employee_ids"


def parse_ids(text: str) -> list[int]:
    """``"3,1,2"`` -> ``[3, 1, 2]`` (order kept, repeats dropped); 422 when empty or not ids."""
    out: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise services.invalid("employee_ids must be employee ids separated by commas.", IDS)
        if int(part) not in out:
            out.append(int(part))
    if not out:
        raise services.invalid("Choose at least one employee.", IDS)
    return out


async def slip_scope(db: AsyncSession, user: User, branch_id: int) -> services.Scope:
    """The Salary report's branch rule, said out loud: a user who may not switch branches gets
    a 403 for another branch instead of silently getting their own."""
    scope = await services.scope_for(db, user, branch_id)
    if scope.branch_id != branch_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="You can only print pay slips of your own branch."
        )
    return scope


async def sheet_ledgers(
    db: AsyncSession, scope: services.Scope, year: int, month: int, ids: list[int]
) -> list[ledgers.MonthLedger]:
    """The report rows' ledgers of ``ids``, in that order. Anyone who is not on the branch's
    Salary report for the month is refused (never dropped): 404 unknown employee, 403 another
    branch, 422 not on the sheet."""
    data = await reports.salary_report(db, scope, year, month, None)
    on_sheet = {ledger.employee.id: ledger for ledger in data.ledgers}
    missing = [i for i in ids if i not in on_sheet]
    if missing:
        known = {
            e.id: e for e in await db.scalars(select(Employee).where(Employee.id.in_(missing)))
        }
        for i in missing:
            employee = known.get(i)
            if employee is None:
                raise services.not_found(f"No employee with id {i}.")
            services.ensure_visible(scope, employee)
            raise services.invalid(
                f"{employee.full_name} is not on the salary report for "
                f"{reports.month_label(year, month)}.",
                IDS,
            )
    return [on_sheet[i] for i in ids]


def slip_out(
    ledger: ledgers.MonthLedger,
    modes: dict[int, PaymentMode],
    printed: slip_prints.LastPrint | None = None,
) -> PayslipOut:
    e, a, pay, settled = ledger.employee, ledger.attendance, ledger.pay, ledger.settled
    pay_type = ledger.structure.pay_type.value
    reasons = rules.unpaid_reasons(a) if pay_type == "monthly" else []
    amounts = rules.split_deduction(pay.absence_deduction, [days for _, days in reasons])
    return PayslipOut(
        employee=PayslipEmployeeOut(
            id=e.id,
            code=e.code,
            name=e.full_name,
            role=e.designation,
            department=e.department.name if e.department else None,
            pay_type=pay_type,
            rate=ledger.rate,
        ),
        month=PayslipMonthOut(
            bs_year=ledger.year,
            bs_month=ledger.month,
            name=bsdate.bs_month_name(ledger.month),
            days_in_month=a.days_in_month,
        ),
        in_progress=ledger.in_progress,
        days_counted=a.days_counted,
        paid_days=pay.paid_days,
        absent_days=a.absent,
        absent_dates=[bsdate.ad_to_bs(day).isoformat() for day in a.absent_dates],
        overtime_hours=a.overtime_hours + a.saturday_ot_hours,
        overtime_amount=pay.overtime_pay,
        overtime_rate=ledger.structure.ot_rate,
        base_amount=pay.gross_salary,
        day_rate=rules.day_rate(pay_type, ledger.rate),
        absence_deduction=pay.absence_deduction,
        deductions=[
            PayslipDeductionOut(reason=reason, days=days, amount=amount)
            for (reason, days), amount in zip(reasons, amounts, strict=True)
        ],
        earned=pay.net,
        advances=[
            PayslipPaymentOut(
                date=services.date_both(p.date),
                kind=p.kind.value,
                mode=modes[p.payment_mode_id].name,
                amount=p.amount,
            )
            for p in ledger.payments
        ],
        advances_total=settled.paid,
        balance_due=settled.due,
        unmarked_days=a.not_marked,
        slip_printed_at=printed.at if printed else None,
        slip_printed_by=printed.by if printed else None,
    )


async def payslips(
    db: AsyncSession, user: User, branch_id: int, year: int, month: int, ids: list[int]
) -> PayslipsOut:
    scope = await slip_scope(db, user, branch_id)
    rows = await sheet_ledgers(db, scope, year, month, ids)
    modes = await services.modes_by_id(db)
    branch = await db.get(Branch, scope.branch_id)
    printed = await slip_prints.latest(db, ids, year, month)
    return PayslipsOut(
        business=await company_name(db),
        branch=reports.branch_ref(branch),
        month=BsMonthOut(bs_year=year, bs_month=month),
        today=services.date_both(bsdate.today_ad()),
        slips=[slip_out(ledger, modes, printed.get(ledger.employee.id)) for ledger in rows],
    )


async def mark_printed(
    db: AsyncSession, user: User, branch_id: int, year: int, month: int, ids: list[int]
) -> list[PayslipPrintedOut]:
    """Remember that these slips went to the printer: one history row each. The same branch
    and sheet rules as reading the slips."""
    ids = list(dict.fromkeys(ids))
    scope = await slip_scope(db, user, branch_id)
    await sheet_ledgers(db, scope, year, month, ids)
    at = await slip_prints.record(db, user, ids, year, month)
    await db.commit()
    by = services.user_label(user)
    return [PayslipPrintedOut(employee_id=i, slip_printed_at=at, slip_printed_by=by) for i in ids]
