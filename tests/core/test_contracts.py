import pytest

from app import contracts
from app.contracts import (
    AttendanceSummary,
    FakeAttendanceSummary,
    MonthSummary,
    get_attendance_summary,
    register_attendance_summary,
    reset_attendance_summary,
)

pytestmark = pytest.mark.anyio


async def test_fake_summary_is_deterministic_and_consistent():
    fake = FakeAttendanceSummary()
    first = await fake.for_month(1, 2083, 7)
    second = await fake.for_month(1, 2083, 7)
    assert first == second
    assert isinstance(first, MonthSummary)
    assert first.days_in_month in range(28, 33)
    marked = first.present + first.overtime_days + first.absent + first.weekly_off
    assert marked <= first.days_in_month, "the rest of the month is 'not marked'"
    assert first.paid_days == first.present + first.overtime_days + first.weekly_off
    assert first.paid_days <= first.days_in_month
    assert first.overtime_hours >= first.overtime_days  # at least one hour per overtime day
    assert (first.overtime_hours > 0) == (first.overtime_days > 0)
    assert not hasattr(first, "late") and not hasattr(first, "half_days")
    assert not hasattr(first, "leave")
    assert await fake.for_month(2, 2083, 7) != first


async def test_registry_returns_fake_until_real_implementation_registers():
    reset_attendance_summary()
    assert isinstance(get_attendance_summary(), FakeAttendanceSummary)

    class Real:
        async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
            return MonthSummary(
                days_in_month=30,
                present=24,
                overtime_days=2,
                overtime_hours=5,
                absent=0,
                weekly_off=4,
                paid_days=30,
            )

    real = Real()
    assert isinstance(real, AttendanceSummary)
    register_attendance_summary(real)
    try:
        assert get_attendance_summary() is real
        summary = await get_attendance_summary().for_month(7, 2083, 7)
        assert summary.present == 24 and summary.overtime_hours == 5
    finally:
        reset_attendance_summary()
    assert isinstance(contracts.get_attendance_summary(), FakeAttendanceSummary)


# ---------------------------------------------------------------- payroll payments


from app.contracts import (  # noqa: E402
    CASH_PAYMENT_MODE_ID,
    FakePayrollPayments,
    MonthBalance,
    PaymentInput,
    PaymentRecord,
    PaymentRejected,
    PaymentResult,
    PayrollPayments,
    get_payroll_payments,
    register_payroll_payments,
    reset_payroll_payments,
    resolve_payment_date,
    resolve_payment_month,
)


async def test_fake_balance_is_deterministic_and_adds_up():
    fake = FakePayrollPayments()
    first = await fake.balance(4, 2083, 7)
    assert first == await fake.balance(4, 2083, 7)
    assert isinstance(first, MonthBalance)
    assert (first.month_key, first.month_label) == ("2083-07", "Kartik 2083")
    assert first.earned > 0
    assert first.due == max(0, first.earned - first.paid)
    # Employee 1 has paid nothing, 2 has 5,000 of advances, 3 has 8,000 incl. a part salary.
    assert (await fake.balance(1, 2083, 7)).paid == 0
    assert (await fake.balance(2, 2083, 7)).paid == 5000
    assert (await fake.balance(3, 2083, 7)).paid == 8000
    history = await fake.for_month(2083, 7, [1, 2, 3])
    assert 1 not in history
    assert [p.kind for p in history[3]] == ["advance", "advance", "salary"]
    assert [p.date_bs for p in history[3]] == ["2083-07-03", "2083-07-09", "2083-07-15"]
    assert all(isinstance(p, PaymentRecord) and p.payment_mode == "Cash" for p in history[3])
    assert history[3][2].receipt_no == "SAL-0303"


async def test_fake_record_reduces_due_and_shows_in_the_month_lookup():
    fake = FakePayrollPayments()
    before = await fake.balance(4, 2083, 7)
    result = await fake.record(
        PaymentInput(employee_id=4, kind="advance", amount=1500, date_bs="2083-07-07", note="Cash")
    )
    assert isinstance(result, PaymentResult)
    assert result.due_after == before.due - 1500
    assert result.payment.receipt_no == f"ADV-{result.payment.payment_id:04d}"
    assert result.payment.payment_mode_id == CASH_PAYMENT_MODE_ID
    assert (result.payment.for_year, result.payment.for_month) == (2083, 7)
    assert result.payment.date.isoformat() == "2026-10-24"
    assert result.payment.source == "scan"
    after = await fake.balance(4, 2083, 7)
    assert after.paid == before.paid + 1500
    assert (await fake.for_month(2083, 7, [4]))[4][-1] is result.payment
    # Without an id list the fake can only report who was paid through it.
    assert list(await fake.for_month(2083, 7)) == [4]
    fake.reset()
    assert (await fake.balance(4, 2083, 7)) == before


async def test_fake_rejects_zero_and_over_due_amounts():
    fake = FakePayrollPayments()
    due = (await fake.balance(4, 2083, 7)).due
    with pytest.raises(PaymentRejected) as zero:
        await fake.record(
            PaymentInput(employee_id=4, kind="salary", amount=0, date_bs="2083-07-07")
        )
    assert zero.value.code == "amount"
    with pytest.raises(PaymentRejected) as over:
        await fake.record(
            PaymentInput(employee_id=4, kind="salary", amount=due + 1, date_bs="2083-07-07")
        )
    assert over.value.code == "over_due"
    assert "Kartik 2083" in str(over.value)
    assert (await fake.balance(4, 2083, 7)).due == due


def test_payment_dates_default_to_today_and_derive_each_other():
    import datetime as dt

    from app.core import bsdate

    ad, bs = resolve_payment_date(PaymentInput(employee_id=1, kind="advance", amount=1))
    assert ad == bsdate.today_ad() and bs == bsdate.today_bs().isoformat()
    ad, bs = resolve_payment_date(
        PaymentInput(employee_id=1, kind="advance", amount=1, date=dt.date(2026, 10, 21))
    )
    assert (ad, bs) == (dt.date(2026, 10, 21), "2083-07-04")
    ad, bs = resolve_payment_date(
        PaymentInput(employee_id=1, kind="advance", amount=1, date_bs="2083-07-04")
    )
    assert (ad, bs) == (dt.date(2026, 10, 21), "2083-07-04")


async def test_payroll_registry_returns_fake_until_payroll_registers():
    reset_payroll_payments()
    assert isinstance(get_payroll_payments(), FakePayrollPayments)

    class Real:
        async def balance(self, employee_id: int, bs_year: int, bs_month: int) -> MonthBalance:
            return MonthBalance(
                employee_id, bs_year, bs_month, "2083-07", "Kartik 2083", 20000, 5000, 15000
            )

        async def record(
            self, payment: PaymentInput, recorded_by: int | None = None
        ) -> PaymentResult:
            raise PaymentRejected("unknown_employee", "No such employee.")

        async def for_month(
            self, for_year: int, for_month: int, employee_ids=None
        ) -> dict[int, list[PaymentRecord]]:
            return {}

    real = Real()
    assert isinstance(real, PayrollPayments)
    register_payroll_payments(real)
    try:
        assert get_payroll_payments() is real
        assert (await get_payroll_payments().balance(7, 2083, 7)).due == 15000
    finally:
        reset_payroll_payments()
    assert isinstance(contracts.get_payroll_payments(), FakePayrollPayments)


async def test_payment_counts_for_the_month_it_is_for_not_the_month_it_is_paid_in():
    """Ashoj's salary paid on Kartik 2 counts for Ashoj (2083-06), not Kartik."""
    fake = FakePayrollPayments()
    ashoj = await fake.balance(4, 2083, 6)
    kartik = await fake.balance(4, 2083, 7)
    result = await fake.record(
        PaymentInput(
            employee_id=4,
            kind="salary",
            amount=1000,
            date_bs="2083-07-02",
            for_year=2083,
            for_month=6,
            source="account",
        )
    )
    assert (result.payment.for_year, result.payment.for_month) == (2083, 6)
    assert result.payment.date_bs == "2083-07-02"
    assert result.due_after == ashoj.due - 1000
    assert (await fake.balance(4, 2083, 6)).paid == ashoj.paid + 1000
    assert (await fake.balance(4, 2083, 7)) == kartik
    assert result.payment in (await fake.for_month(2083, 6, [4]))[4]
    assert result.payment not in (await fake.for_month(2083, 7, [4])).get(4, [])
    # Without for_year / for_month the month of the date is used.
    scan = await fake.record(
        PaymentInput(employee_id=4, kind="advance", amount=500, date_bs="2083-07-02")
    )
    assert (scan.payment.for_year, scan.payment.for_month) == (2083, 7)


def test_for_month_pair_is_validated():
    base = dict(employee_id=1, kind="advance", amount=1)
    assert resolve_payment_month(PaymentInput(**base), "2083-07-02") == (2083, 7)
    assert resolve_payment_month(
        PaymentInput(**base, for_year=2083, for_month=6), "2083-07-02"
    ) == (2083, 6)
    with pytest.raises(ValueError):
        resolve_payment_month(PaymentInput(**base, for_year=2083), "2083-07-02")
    with pytest.raises(ValueError):
        resolve_payment_month(PaymentInput(**base, for_year=2083, for_month=13), "2083-07-02")
