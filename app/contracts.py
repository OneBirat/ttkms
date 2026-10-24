"""Cross-module contracts.

Modules talk to each other only through these interfaces - never by importing another module's
internals. Payroll asks attendance for a month summary through :func:`get_attendance_summary`;
until the attendance module calls :func:`register_attendance_summary` with its implementation,
the deterministic :class:`FakeAttendanceSummary` is returned so payroll can be built and tested
on its own.

Attendance rules (decided 24 Oct 2026, ``app/modules/attendance/API_NOTES.md``): a day is only
``P`` present, ``O`` overtime (present + whole hours 1-12) or ``A`` absent; weekly off (Saturday)
without a record is paid; "not marked" means no record. Paid days = present + overtime days +
weekly off. Overtime hours are paid hourly by payroll.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class MonthSummary:
    """One employee's attendance for one BS month, the way payroll needs it."""

    days_in_month: int
    #: Days marked P.
    present: int
    #: Days marked O (present with overtime).
    overtime_days: int
    #: Sum of the overtime hours of those days.
    overtime_hours: int
    #: Days marked A (unpaid).
    absent: int
    #: Weekly-off days without a record (paid).
    weekly_off: int
    #: present + overtime_days + weekly_off.
    paid_days: int


@runtime_checkable
class AttendanceSummary(Protocol):
    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary: ...


def _days_in_month(bs_year: int, bs_month: int) -> int:
    from app.core import bsdate

    return bsdate.days_in_month(bs_year, bs_month)


class FakeAttendanceSummary:
    """Deterministic sample data: the same inputs always give the same summary, and the days
    add up (present + overtime_days + absent + weekly_off + not marked = days_in_month)."""

    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
        days = _days_in_month(bs_year, bs_month)
        seed = (employee_id * 31 + bs_year * 12 + bs_month) % 7
        weekly_off = sum(1 for d in range(days) if (d + seed) % 7 == 0)
        working = days - weekly_off
        absent = (seed + 1) % 2
        not_marked = seed % 3
        overtime_days = (seed + employee_id) % 4
        overtime_hours = overtime_days * (2 + seed % 3)
        present = working - absent - not_marked - overtime_days
        return MonthSummary(
            days_in_month=days,
            present=present,
            overtime_days=overtime_days,
            overtime_hours=overtime_hours,
            absent=absent,
            weekly_off=weekly_off,
            paid_days=present + overtime_days + weekly_off,
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
