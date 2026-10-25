"""Attendance tables (Postgres schema ``attendance``).

* ``records`` - one row per employee per attendance day (an AD date in Asia/Kathmandu). Status is
  only ``P`` present, ``O`` overtime (present + whole hours 1-12) or ``A`` absent. "Not marked"
  is no row; the weekly off (Saturday) is computed, never stored - a Saturday row means the
  person came in (P / O). The BS date is derived on output (docs/bs-calendar.md).
* ``record_changes`` - the audit trail: one row per insert, change or clear (``new_status``
  null), with who and when.

Employees live in ``core.employees`` (``ON DELETE RESTRICT``). Migration order: ``core`` ->
``admin`` -> ``payroll`` -> ``attendance`` (README).
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
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

    employee: Mapped[Employee] = relationship(lazy="raise")
    marker: Mapped[User | None] = relationship(lazy="raise")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Record {self.employee_id} {self.date} {self.status}{self.overtime_hours or ''}>"


class RecordChange(Base):
    """One change to a day's mark. ``old_status`` null = it was not marked; ``new_status`` null
    = the mark was cleared. ``record_id`` is kept as a plain number (a cleared record is gone)."""

    __tablename__ = "record_changes"
    __table_args__ = (
        Index("ix_record_changes_employee_date", "employee_id", "date"),
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
