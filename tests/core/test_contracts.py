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
