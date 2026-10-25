"""Pay rules: monthly absences in 29/30/31/32-day BS months, daily wage, overtime, the fixed
/30 overtime-rate rule, settlement and status."""

from app.contracts import MonthSummary
from app.core import bsdate
from app.modules.payroll.rules import (
    daily_pay,
    default_ot_rate,
    month_status,
    monthly_pay,
    overtime_pay,
    pay_for,
    round_rs,
    settle,
)


def summary(days: int, present: int = 0, absent: int = 0, ot_days: int = 0, ot_hours: int = 0):
    weekly_off = max(0, days - present - absent - ot_days)
    return MonthSummary(
        days_in_month=days,
        present=present,
        overtime_days=ot_days,
        overtime_hours=ot_hours,
        absent=absent,
        weekly_off=weekly_off,
        paid_days=present + ot_days + weekly_off,
        days_counted=days,
    )


def _month_with(days: int) -> tuple[int, int]:
    for year in (2083, 2082, 2084):
        for month in range(1, 13):
            if bsdate.days_in_month(year, month) == days:
                return year, month
    raise AssertionError(f"no BS month with {days} days near 2083")


def test_rounding_is_half_up():
    assert round_rs(2.5) == 3 and round_rs(2.49) == 2 and round_rs(-0.4) == 0


def test_monthly_absence_divides_by_a_fixed_30_whatever_the_month_length():
    salary = 30000
    for days in (29, 30, 31, 32):
        year, month = _month_with(days)
        assert bsdate.days_in_month(year, month) == days
        result = monthly_pay(salary, 125, summary(days, present=days - 2, absent=2))
        assert result.absence_deduction == round_rs(salary / 30 * 2) == 2000
        assert result.net == salary - 2000
        assert result.paid_days == days - 2
        assert result.gross_salary == salary and result.earnings == salary and result.tds == 0
    # Two absent days cost the same in a 29-day month as in a 32-day one.
    assert (
        monthly_pay(salary, 0, summary(29, present=27, absent=2)).absence_deduction
        == monthly_pay(salary, 0, summary(32, present=30, absent=2)).absence_deduction
        == 2000
    )
    assert monthly_pay(22000, 0, summary(31, present=30, absent=1)).absence_deduction == 733
    # Full month, nothing absent: the whole salary; Saturdays count as paid days.
    full = monthly_pay(salary, 0, summary(30, present=26))
    assert full.net == salary and full.paid_days == 30
    # Absence can never exceed the salary.
    assert monthly_pay(salary, 0, summary(30, present=0, absent=30)).net == 0


def test_default_overtime_rate_ignores_the_month_length():
    assert default_ot_rate("monthly", 24000) == 100  # 24000 / 30 / 8
    assert default_ot_rate("monthly", 22000) == round_rs(22000 / 30 / 8) == 92
    assert default_ot_rate("daily", 650) == round_rs(650 / 8) == 81
    # Ashadh 2083 has 32 days, another month 29: the rate is the same either way.
    long_year, long_month = _month_with(32)
    short_year, short_month = _month_with(29)
    assert bsdate.days_in_month(long_year, long_month) == 32
    assert bsdate.days_in_month(short_year, short_month) == 29
    rate = default_ot_rate("monthly", 24000)
    long_pay = monthly_pay(24000, rate, summary(32, present=30, ot_days=2, ot_hours=4))
    short_pay = monthly_pay(24000, rate, summary(29, present=27, ot_days=2, ot_hours=4))
    assert long_pay.overtime_pay == short_pay.overtime_pay == 4 * rate == 400


def test_overtime_is_whole_hours_times_rate():
    assert overtime_pay(3, 100) == 300
    assert overtime_pay(0, 100) == 0 and overtime_pay(-2, 100) == 0 and overtime_pay(2, -5) == 0
    with_ot = monthly_pay(24000, 100, summary(30, present=24, ot_days=2, ot_hours=5))
    assert with_ot.overtime_pay == 500 and with_ot.earnings == 24500 and with_ot.net == 24500


def test_daily_wage_pays_days_worked_and_overtime_only():
    result = daily_pay(650, 81, summary(30, present=22, ot_days=2, ot_hours=3, absent=1))
    assert result.paid_days == 24
    assert result.gross_salary == 650 * 24
    assert result.overtime_pay == 243
    assert result.absence_deduction == 0
    assert result.net == 650 * 24 + 243
    assert pay_for("daily", 650, 81, summary(30, present=22)).net == 650 * 22
    assert pay_for("monthly", 30000, 125, summary(30, present=30)).net == 30000


def test_settle_and_status():
    s = settle(20000, [("advance", 2000), ("advance", 3000), ("salary", 4500)])
    assert (s.advance_paid, s.salary_paid, s.paid, s.due) == (5000, 4500, 9500, 10500)
    assert s.status == "part_paid"
    assert settle(20000, []).status == "pending" and settle(20000, []).due == 20000
    paid = settle(20000, [("salary", 20000)])
    assert paid.status == "paid" and paid.due == 0
    # Overpayment never shows a negative due.
    assert settle(20000, [("salary", 25000)]).due == 0
    assert month_status(0, 0) == "paid"


def _sat(days=30, counted=None, absent=0, ot_hours=0, sat_days=0, sat_hours=0):
    return MonthSummary(
        days_in_month=days,
        present=20,
        overtime_days=0,
        overtime_hours=ot_hours,
        absent=absent,
        weekly_off=4,
        paid_days=24,
        days_counted=days if counted is None else counted,
        saturday_days_worked=sat_days,
        saturday_ot_hours=sat_hours,
    )


def test_running_month_is_prorated_by_days_counted_capped_at_30():
    """Option B (decided 2026-10-25): salary x min(days_counted, 30) / 30 - absences so far x
    salary / 30 + overtime so far. Past months are never prorated."""
    so_far = monthly_pay(30000, 125, _sat(counted=10, absent=1, ot_hours=2), so_far=True)
    assert (so_far.gross_salary, so_far.absence_deduction, so_far.overtime_pay) == (
        10000,
        1000,
        250,
    )
    assert so_far.net == 9250 and so_far.paid_days == 9
    late = monthly_pay(30000, 125, _sat(days=32, counted=32), so_far=True)
    assert late.gross_salary == 30000  # min(32, 30) / 30
    short = monthly_pay(30000, 125, _sat(days=29, counted=29), so_far=True)
    assert short.gross_salary == 29000  # until the month closes
    closed = monthly_pay(30000, 125, _sat(days=29, counted=29))
    assert closed.gross_salary == 30000
    first_day = monthly_pay(30000, 125, _sat(counted=1, absent=1), so_far=True)
    assert first_day.net == 0  # an absence never takes the month below zero


def test_saturday_work_overtime_only_pays_the_hours():
    s = _sat(sat_days=2, sat_hours=6, ot_hours=3)
    pay = monthly_pay(30000, 125, s, saturday_rule="overtime_only")
    assert pay.overtime_pay == 9 * 125 and pay.saturday_pay == 0
    assert pay.net == 30000 + 1125


def test_saturday_work_extra_day_also_pays_salary_over_30():
    s = _sat(sat_days=2, sat_hours=6, ot_hours=3)
    pay = monthly_pay(30000, 125, s, saturday_rule="extra_day")
    assert pay.saturday_pay == 2000 and pay.gross_salary == 32000
    assert pay.net == 30000 + 2000 + 1125
    assert pay.gross_salary - pay.absence_deduction + pay.overtime_pay == pay.net


def test_daily_staff_get_the_wage_for_saturday_work_whatever_the_rule():
    s = MonthSummary(
        days_in_month=30,
        present=10,
        overtime_days=1,
        overtime_hours=2,
        absent=0,
        weekly_off=4,
        paid_days=15,
        days_counted=30,
        saturday_days_worked=1,
        saturday_ot_hours=3,
    )
    for rule in ("overtime_only", "extra_day"):
        pay = pay_for("daily", 800, 100, s, saturday_rule=rule)
        assert pay.gross_salary == 800 * 12 and pay.overtime_pay == 500
