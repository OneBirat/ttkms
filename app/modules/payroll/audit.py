"""Read-only checks over the payroll figures (``python -m app.cli unmarked-paid``).

Until 2026-11-12 a past working day without an attendance record was paid as if present. This
lists every month that already has payments and has such "not marked" days: what the month was
worth under the old rule, what it is worth now, and how much is paid above the new net pay.
Nothing is written.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Employee
from app.modules.payroll import ledgers, rules
from app.modules.payroll.reports import month_label


@dataclass(frozen=True)
class UnmarkedPaidMonth:
    employee_id: int
    code: str
    name: str
    year: int
    month: int
    label: str
    not_marked: int
    #: Net pay with the not-marked days paid (the old rule) and as it is now.
    old_net: int
    net: int
    paid: int
    #: Paid above the new net pay (0 when the month is not overpaid).
    overpaid: int


async def unmarked_paid_months(db: AsyncSession) -> list[UnmarkedPaidMonth]:
    """Months with at least one (non-voided) payment whose pay went down because of not-marked
    days, oldest first per employee."""
    employees = list(await db.scalars(select(Employee).order_by(Employee.full_name, Employee.id)))
    ids = [e.id for e in employees]
    structures = await ledgers.load_structures(db, ids)
    payments = await ledgers.load_payments(db, ids)
    rule = await ledgers.saturday_rule(db)
    out: list[UnmarkedPaidMonth] = []
    for e in employees:
        mine = payments.get(e.id, [])
        for year, month in sorted({(p.for_year, p.for_month) for p in mine}):
            ledger = await ledgers.ledger_for(
                e, year, month, structures.get(e.id, []), mine, saturday_rule=rule
            )
            if ledger is None or ledger.attendance.not_marked <= 0:
                continue
            old = rules.pay_for(
                ledger.structure.pay_type.value,
                ledger.rate,
                ledger.structure.ot_rate,
                replace(ledger.attendance, not_marked=0),
                so_far=ledger.in_progress,
                saturday_rule=rule,
            )
            if old.net == ledger.net:  # daily wage: never paid for those days
                continue
            out.append(
                UnmarkedPaidMonth(
                    employee_id=e.id,
                    code=e.code,
                    name=e.full_name,
                    year=year,
                    month=month,
                    label=month_label(year, month),
                    not_marked=ledger.attendance.not_marked,
                    old_net=old.net,
                    net=ledger.net,
                    paid=ledger.paid,
                    overpaid=max(0, ledger.paid - ledger.net),
                )
            )
    return out
