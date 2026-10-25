"""Derived figures - never stored: the salary row in force, the month's pay (rules.py), the
month's payments and what is still due. Attendance comes from the AttendanceSummary contract."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import SATURDAY_WORK_RULE_KEY, MonthSummary, get_attendance_summary
from app.core import bsdate
from app.core.models import Employee
from app.core.services import get_setting
from app.modules.payroll import rules
from app.modules.payroll.models import Payment, SalaryHistory

#: The running month and the five before it: the window the account screens and "balance due" use.
MONTHS_KEPT = 6

#: core.settings key (admin Settings > Payroll). PENDING BUSINESS DECISION - see rules.py.
SATURDAY_RULE_KEY = SATURDAY_WORK_RULE_KEY


async def saturday_rule(db: AsyncSession) -> rules.SaturdayRule:
    """How Saturday work is paid to monthly staff (unknown values fall back to the default)."""
    value = await get_setting(db, SATURDAY_RULE_KEY, rules.DEFAULT_SATURDAY_RULE)
    return value if value in rules.SATURDAY_RULES else rules.DEFAULT_SATURDAY_RULE


def current_month() -> tuple[int, int]:
    today = bsdate.today_bs()
    return today.year, today.month


def months_kept(now: tuple[int, int] | None = None) -> list[tuple[int, int]]:
    """Oldest first, the running month last."""
    year, month = now or current_month()
    return [bsdate.shift_month(year, month, -k) for k in range(MONTHS_KEPT - 1, -1, -1)]


def month_index(year: int, month: int) -> int:
    return year * 12 + month - 1


def joined_month(employee: Employee) -> tuple[int, int]:
    joined = bsdate.ad_to_bs(employee.joined_ad)
    return joined.year, joined.month


def structure_for(
    structures: Sequence[SalaryHistory], year: int, month: int
) -> SalaryHistory | None:
    """The salary row in force for a BS month: latest ``effective_ad`` on or before its last day."""
    _, last_day = bsdate.bs_month_range(year, month)
    candidates = [s for s in structures if s.effective_ad <= last_day]
    if not candidates:
        return None
    return max(candidates, key=lambda s: (s.effective_ad, s.id))


@dataclass
class MonthLedger:
    employee: Employee
    year: int
    month: int
    starts: date
    ends: date
    in_progress: bool
    structure: SalaryHistory
    #: Monthly: salary per month (basic + allowances). Daily: wage per day (basic).
    rate: int
    attendance: MonthSummary
    pay: rules.PayResult
    settled: rules.Settled
    #: Oldest first; voided payments are never in here (they count for nothing).
    payments: list[Payment]
    #: Voided payments of the month, oldest first - shown struck through, never summed.
    voided: list[Payment]

    @property
    def net(self) -> int:
        return self.pay.net

    @property
    def due(self) -> int:
        return self.settled.due

    @property
    def paid(self) -> int:
        return self.settled.paid


def rate_of(structure: SalaryHistory) -> int:
    return (
        structure.basic + structure.allowances
        if structure.pay_type.value == "monthly"
        else structure.basic
    )


async def ledger_for(
    employee: Employee,
    year: int,
    month: int,
    structures: Sequence[SalaryHistory],
    payments: Iterable[Payment],
    *,
    saturday_rule: rules.SaturdayRule,
) -> MonthLedger | None:
    """None before the joining month or while the employee has no salary row yet. The running
    month is "so far" (salary prorated by the days counted, rules.monthly_pay)."""
    if month_index(year, month) < month_index(*joined_month(employee)):
        return None
    structure = structure_for(structures, year, month)
    if structure is None:
        return None
    attendance = await get_attendance_summary().for_month(employee.id, year, month)
    pay_type = structure.pay_type.value
    rate = rate_of(structure)
    in_progress = (year, month) == current_month()
    pay = rules.pay_for(
        pay_type,
        rate,
        structure.ot_rate,
        attendance,
        so_far=in_progress,
        saturday_rule=saturday_rule,
    )
    of_month = sorted(
        (p for p in payments if p.for_year == year and p.for_month == month),
        key=lambda p: (p.date, p.id),
    )
    month_payments = [p for p in of_month if p.voided_at is None]
    settled = rules.settle(pay.net, [(p.kind.value, p.amount) for p in month_payments])
    starts, ends = bsdate.bs_month_range(year, month)
    return MonthLedger(
        employee=employee,
        year=year,
        month=month,
        starts=starts,
        ends=ends,
        in_progress=in_progress,
        structure=structure,
        rate=rate,
        attendance=attendance,
        pay=pay,
        settled=settled,
        payments=month_payments,
        voided=[p for p in of_month if p.voided_at is not None],
    )


async def load_structures(
    db: AsyncSession, employee_ids: Iterable[int]
) -> dict[int, list[SalaryHistory]]:
    ids = list(employee_ids)
    out: dict[int, list[SalaryHistory]] = defaultdict(list)
    if not ids:
        return out
    rows = await db.scalars(
        select(SalaryHistory)
        .where(SalaryHistory.employee_id.in_(ids))
        .order_by(SalaryHistory.effective_ad, SalaryHistory.id)
    )
    for row in rows:
        out[row.employee_id].append(row)
    return out


async def load_payments(
    db: AsyncSession,
    employee_ids: Iterable[int],
    months: Sequence[tuple[int, int]] | None = None,
    *,
    include_voided: bool = False,
) -> dict[int, list[Payment]]:
    """Payments per employee, oldest first. Voided ones only with ``include_voided`` (the
    ledger screens show them struck through; every sum leaves them out either way)."""
    ids = list(employee_ids)
    out: dict[int, list[Payment]] = defaultdict(list)
    if not ids:
        return out
    query = select(Payment).where(Payment.employee_id.in_(ids)).order_by(Payment.date, Payment.id)
    if not include_voided:
        query = query.where(Payment.voided_at.is_(None))
    if months:
        years = {y for y, _ in months}
        query = query.where(Payment.for_year.in_(years))
    for row in await db.scalars(query):
        if months and (row.for_year, row.for_month) not in set(months):
            continue
        out[row.employee_id].append(row)
    return out


async def ledgers_kept(
    employee: Employee,
    structures: Sequence[SalaryHistory],
    payments: Iterable[Payment],
    *,
    saturday_rule: rules.SaturdayRule,
) -> list[MonthLedger]:
    """Oldest first, from the joining month, within the kept window."""
    payments = list(payments)
    out: list[MonthLedger] = []
    for year, month in months_kept():
        ledger = await ledger_for(
            employee, year, month, structures, payments, saturday_rule=saturday_rule
        )
        if ledger is not None:
            out.append(ledger)
    return out


async def balance_due(
    employee: Employee,
    structures: Sequence[SalaryHistory],
    payments: Iterable[Payment],
    *,
    saturday_rule: rules.SaturdayRule,
) -> int:
    kept = await ledgers_kept(employee, structures, payments, saturday_rule=saturday_rule)
    return sum(ledger.due for ledger in kept)
