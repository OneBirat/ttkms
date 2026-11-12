"""Attendance tables (Postgres schema ``attendance``).

* ``records`` - one row per employee per attendance day (an AD date in Asia/Kathmandu). Status is
  only ``P`` present, ``O`` overtime (present + whole hours 1-12) or ``A`` absent. "Not marked"
  is no row; the weekly off (Saturday) is computed, never stored - a Saturday row means the
  person came in (P / O). The BS date is derived on output (docs/bs-calendar.md).
* ``record_changes`` - the history: one row per insert, change or clear (``new_status``
  null), with who and when; a super-admin change to a past day also carries the reason and
  ``is_override``. Append-only: database triggers (attendance_0004) refuse every UPDATE,
  DELETE and TRUNCATE, so history rows cannot be edited or deleted.

* ``holidays`` / ``holiday_branches`` - public holidays, one dated entry each (no recurrence),
  for every branch or a chosen list. Only the super admin writes them, and only for today or a
  later day; once the day has passed the entry is locked. Applied when attendance and pay are
  read: no attendance row is ever written or rewritten for a holiday.

Employees live in ``core.employees`` (``ON DELETE RESTRICT``). Migration order: ``core`` ->
``admin`` -> ``payroll`` -> ``attendance`` (README).
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.models import Employee, User
from app.db import Base

SCHEMA = "attendance"

#: An override needs a reason of at least this many characters.
REASON_MIN = 5
REASON_MAX = 300

#: Overtime is whole hours, 1-12, and only with status O.
OT_MIN = 1
OT_MAX = 12


class Status(enum.StrEnum):
    present = "P"
    overtime = "O"
    absent = "A"


class Source(enum.StrEnum):
    manual = "manual"
    scan = "scan"
    bulk = "bulk"


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (
        UniqueConstraint("employee_id", "date"),
        CheckConstraint("status IN ('P', 'O', 'A')", name="status"),
        CheckConstraint(
            f"overtime_hours BETWEEN 0 AND {OT_MAX} AND (status = 'O') = (overtime_hours > 0)",
            name="overtime_hours",
        ),
        CheckConstraint("source IN ('manual', 'scan', 'bulk')", name="source"),
        Index("ix_records_date_branch", "date", "branch_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("core.employees.id", ondelete="RESTRICT"), nullable=False
    )
    #: The attendance day: an AD calendar date in Asia/Kathmandu.
    date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(1), nullable=False)
    overtime_hours: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default=text("0")
    )
    #: The employee's branch on that day (kept when they move later).
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("core.branches.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(6), nullable=False)
    marked_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    marked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    note: Mapped[str] = mapped_column(
        String(200), nullable=False, default="", server_default=text("''")
    )
    #: When the day's mark was FIRST saved (the app server's clock). The mark can be changed or
    #: removed for 24 hours from here; editing never moves it (``marked_at`` does move).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    employee: Mapped[Employee] = relationship(lazy="raise")
    marker: Mapped[User | None] = relationship(lazy="raise")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Record {self.employee_id} {self.date} {self.status}{self.overtime_hours or ''}>"


class RecordChange(Base):
    """One change to a day's mark. ``old_status`` null = it was not marked; ``new_status`` null
    = the mark was cleared. ``record_id`` is kept as a plain number (a cleared record is gone).
    Rows are only ever inserted (the table's triggers refuse anything else)."""

    __tablename__ = "record_changes"
    __table_args__ = (
        Index("ix_record_changes_employee_date", "employee_id", "date"),
        CheckConstraint(
            f"NOT is_override OR char_length(btrim(reason)) >= {REASON_MIN}",
            name="override_reason",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    record_id: Mapped[int | None] = mapped_column(BigInteger)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("core.employees.id", ondelete="RESTRICT"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(1))
    new_status: Mapped[str | None] = mapped_column(String(1))
    old_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    new_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    old_note: Mapped[str] = mapped_column(String(200), nullable=False, server_default=text("''"))
    new_note: Mapped[str] = mapped_column(String(200), nullable=False, server_default=text("''"))
    source: Mapped[str] = mapped_column(String(6), nullable=False)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: The person's name when they made the change (stays when the user row goes).
    changed_by_name: Mapped[str] = mapped_column(
        String(120), nullable=False, default="", server_default=text("''")
    )
    #: Why, for an override (required there); "" for an ordinary change.
    reason: Mapped[str] = mapped_column(
        String(REASON_MAX), nullable=False, default="", server_default=text("''")
    )
    #: True when the super admin changed a past day (the lock was overridden).
    is_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )


HOLIDAY_NAME_MAX = 120


class Holiday(Base):
    """A public holiday on one AD date (Asia/Kathmandu day). ``all_branches`` false = only the
    branches in ``holiday_branches``. Two holidays never share a date and a branch (service
    layer, 409). ``is_paid``: staff are not counted absent and nothing is cut for the day."""

    __tablename__ = "holidays"
    __table_args__ = (Index("ix_holidays_date", "date"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    name: Mapped[str] = mapped_column(String(HOLIDAY_NAME_MAX), nullable=False)
    all_branches: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    is_paid: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    branches: Mapped[list[HolidayBranch]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )

    def applies_to(self, branch_id: int) -> bool:
        return self.all_branches or any(b.branch_id == branch_id for b in self.branches)


class HolidayBranch(Base):
    """A branch of a holiday with ``all_branches`` false."""

    __tablename__ = "holiday_branches"
    __table_args__ = ({"schema": SCHEMA},)

    holiday_id: Mapped[int] = mapped_column(
        ForeignKey(f"{SCHEMA}.holidays.id", ondelete="CASCADE"), primary_key=True
    )
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("core.branches.id", ondelete="CASCADE"), primary_key=True
    )
