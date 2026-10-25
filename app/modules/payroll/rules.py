"""Pay rules, pure and unit-tested (tests/payroll/test_rules.py; twin of calc.ts in web/app/people).

Decided rules (the brief overrides any older design text):

* Monthly: ``net = salary - (salary / 30 * absent) + overtime - TDS`` - a fixed 30-day divisor
  whatever the BS month's real length. Saturdays (the weekly off) are paid. No half days, no
  leave.
* Running month ("earned so far", which also caps advances): the salary is prorated as
  ``salary * min(days_counted, 30) / 30`` (days_counted = today's BS day), then the absences and
  overtime so far apply as above. Past months are never prorated.
* Saturday work (PENDING BUSINESS DECISION, setting ``payroll.saturday_work_rule``): monthly
  staff are paid the Saturday overtime hours (``overtime_only``, the default), or also salary /
  30 per Saturday worked (``extra_day``). Daily staff always get the day's wage plus the hours
  for a Saturday worked, whatever the setting.
* Daily: ``net = wage * (present + overtime_days + Saturdays worked) + overtime - TDS``. Nothing
  to deduct.
* Overtime: whole hours x the employee's hourly rate. Default rate ``round(salary / 30 / 8)`` -
  always 30, whatever the BS month length - and ``round(wage / 8)`` for daily staff; editable on
  every salary revision.
* Advances are part-payments of that month's salary: nothing to recover, nothing carried over.
  ``due = max(0, net - payments of the month)``.
* No SSF. TDS stays 0 for now (a later decision; the card keeps showing 0).

Attendance comes ONLY from the AttendanceSummary contract (MonthSummary).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.contracts import (
    DEFAULT_SATURDAY_WORK_RULE,
    SATURDAY_WORK_RULES,
    MonthSummary,
    SaturdayWorkRule,
)

PayTypeName = Literal["monthly", "daily"]
MonthStatus = Literal["paid", "part_paid", "pending"]
#: payroll.saturday_work_rule (app/contracts.py) - pending business decision; see above.
SaturdayRule = SaturdayWorkRule
SATURDAY_RULES = SATURDAY_WORK_RULES
DEFAULT_SATURDAY_RULE = DEFAULT_SATURDAY_WORK_RULE

#: A monthly salary is divided by this many days - for the absence deduction and the default
#: overtime rate alike - never by the month's real length, so a day costs the same in a 29- and
#: a 32-day month.
PAY_DAYS = 30
OT_DAYS = PAY_DAYS
HOURS_PER_DAY = 8


def round_rs(value: float | Decimal) -> int:
    """Whole rupees, half up (0.5 -> 1), like the TypeScript ``roundRs``."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def default_ot_rate(pay_type: PayTypeName, amount: int) -> int:
    """Rupees per overtime hour: one hour of an eight-hour day."""
    if pay_type == "daily":
        return round_rs(amount / HOURS_PER_DAY)
    return round_rs(amount / OT_DAYS / HOURS_PER_DAY)


def overtime_pay(hours: int, ot_rate: int) -> int:
    return round_rs(max(0, int(hours)) * max(0, ot_rate))


@dataclass(frozen=True)
class PayResult:
    paid_days: int
    #: Monthly: the salary. Daily: wage x (present + overtime days).
    gross_salary: int
    overtime_pay: int
    #: gross_salary + overtime_pay (the report's "Gross").
    earnings: int
    #: Monthly: salary / 30 x absent days. Daily: 0.
    absence_deduction: int
    tds: int
    net: int
    #: Monthly with ``extra_day``: salary / 30 x Saturdays worked - already inside gross_salary
    #: (so gross - absence + overtime = net everywhere). Else 0.
    saturday_pay: int = 0


def monthly_pay(
    salary: int,
    ot_rate: int,
    s: MonthSummary,
    *,
    so_far: bool = False,
    saturday_rule: SaturdayRule = DEFAULT_SATURDAY_RULE,
) -> PayResult:
    """``so_far`` for the running month: the salary is prorated by ``s.days_counted`` (capped
    at 30)."""
    per_day = salary / PAY_DAYS
    base = round_rs(salary * min(max(0, s.days_counted), PAY_DAYS) / PAY_DAYS if so_far else salary)
    absence = min(round_rs(per_day * max(0, s.absent)), base)
    overtime = overtime_pay(s.overtime_hours + s.saturday_ot_hours, ot_rate)
    saturday = (
        round_rs(per_day * max(0, s.saturday_days_worked)) if saturday_rule == "extra_day" else 0
    )
    gross = base + saturday
    tds = 0
    days = s.days_counted if so_far else s.days_in_month
    return PayResult(
        paid_days=max(0, days - s.absent),
        gross_salary=gross,
        overtime_pay=overtime,
        earnings=gross + overtime,
        absence_deduction=absence,
        tds=tds,
        net=round_rs(gross - absence + overtime - tds),
        saturday_pay=saturday,
    )


def daily_pay(wage: int, ot_rate: int, s: MonthSummary) -> PayResult:
    """A Saturday worked is a day worked (daily staff are not paid for the weekly off)."""
    worked = max(0, s.present) + max(0, s.overtime_days) + max(0, s.saturday_days_worked)
    gross = round_rs(wage * worked)
    overtime = overtime_pay(s.overtime_hours + s.saturday_ot_hours, ot_rate)
    tds = 0
    return PayResult(
        paid_days=worked,
        gross_salary=gross,
        overtime_pay=overtime,
        earnings=gross + overtime,
        absence_deduction=0,
        tds=tds,
        net=round_rs(gross + overtime - tds),
    )


def pay_for(
    pay_type: PayTypeName,
    rate: int,
    ot_rate: int,
    s: MonthSummary,
    *,
    so_far: bool = False,
    saturday_rule: SaturdayRule = DEFAULT_SATURDAY_RULE,
) -> PayResult:
    if pay_type == "monthly":
        return monthly_pay(rate, ot_rate, s, so_far=so_far, saturday_rule=saturday_rule)
    return daily_pay(rate, ot_rate, s)


@dataclass(frozen=True)
class Settled:
    salary_paid: int
    advance_paid: int
    paid: int
    #: max(0, net - paid)
    due: int
    status: MonthStatus


def month_status(net: int, paid: int) -> MonthStatus:
    """Paid when nothing is due, part paid when something was paid, else pending."""
    if paid >= net and paid > 0:
        return "paid"
    if net <= 0 and paid <= 0:
        return "paid"
    return "part_paid" if paid > 0 else "pending"


def settle(net: int, payments: Iterable[tuple[str, int]]) -> Settled:
    """``payments`` = ``(kind, amount)`` pairs of the month. Due never goes negative."""
    salary_paid = 0
    advance_paid = 0
    for kind, amount in payments:
        if kind == "salary":
            salary_paid += amount
        else:
            advance_paid += amount
    paid = salary_paid + advance_paid
    return Settled(
        salary_paid=salary_paid,
        advance_paid=advance_paid,
        paid=paid,
        due=max(0, round_rs(net - paid)),
        status=month_status(net, paid),
    )
