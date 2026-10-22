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
    assert (
        first.weekly_off + first.leave + first.absent + first.present + first.half_days * 0.5
        == (first.days_in_month)
    )
    assert first.paid_days == first.days_in_month - first.absent
    assert await fake.for_month(2, 2083, 7) != first


async def test_registry_returns_fake_until_real_implementation_registers():
    reset_attendance_summary()
    assert isinstance(get_attendance_summary(), FakeAttendanceSummary)

    class Real:
        async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
            return MonthSummary(30, 26, 1, 0, 0, 0, 4, 30)

    real = Real()
    assert isinstance(real, AttendanceSummary)
    register_attendance_summary(real)
    try:
        assert get_attendance_summary() is real
        summary = await get_attendance_summary().for_month(7, 2083, 7)
        assert summary.present == 26
    finally:
        reset_attendance_summary()
    assert isinstance(contracts.get_attendance_summary(), FakeAttendanceSummary)
