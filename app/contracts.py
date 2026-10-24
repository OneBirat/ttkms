"""Cross-module contracts.

Modules talk to each other only through these interfaces - never by importing another module's
internals. Payroll asks attendance for a month summary through :func:`get_attendance_summary`;
until the attendance module calls :func:`register_attendance_summary` with its implementation,
the deterministic :class:`FakeAttendanceSummary` is returned so payroll can be built and tested
on its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class MonthSummary:
    days_in_month: int
    present: float
    late: int
    half_days: int
    leave: int
    absent: int
    weekly_off: int
    paid_days: float


@runtime_checkable
class AttendanceSummary(Protocol):
    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary: ...


def _days_in_month(bs_year: int, bs_month: int) -> int:
    from app.core import bsdate

    return bsdate.days_in_month(bs_year, bs_month)


class FakeAttendanceSummary:
    """Deterministic sample data: the same inputs always give the same summary."""

    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
        days = _days_in_month(bs_year, bs_month)
        seed = (employee_id * 31 + bs_year * 12 + bs_month) % 7
        weekly_off = sum(1 for d in range(days) if (d + seed) % 7 == 0)
        working = days - weekly_off
        leave = seed % 3
        absent = (seed + 1) % 2
        half_days = (seed + employee_id) % 3
        late = seed
        present = working - leave - absent - half_days * 0.5
        return MonthSummary(
            days_in_month=days,
            present=present,
            late=late,
            half_days=half_days,
            leave=leave,
            absent=absent,
            weekly_off=weekly_off,
            paid_days=float(days - absent),
        )


_fake = FakeAttendanceSummary()
_registered: AttendanceSummary | None = None


def register_attendance_summary(implementation: AttendanceSummary) -> None:
    """Called by the attendance module (e.g. at import time) to replace the fake."""
    global _registered
    _registered = implementation


def reset_attendance_summary() -> None:
    global _registered
    _registered = None


def get_attendance_summary() -> AttendanceSummary:
    return _registered if _registered is not None else _fake
