"""Payroll tables (Postgres schema ``payroll``).

Employees live in ``core.employees`` (single source of truth); everything here is keyed on
``core.employees.id`` with ``ON DELETE RESTRICT``. Ledgers, balances and report rows are never
stored - they are derived from the salary row in force, the attendance contract and the month's
payments (``app.modules.payroll.rules``).

Migration order: ``core`` -> ``admin`` (``admin.payment_modes``) -> ``payroll``; see README.
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.models import Branch, Employee, User, _enum_values
from app.db import Base
from app.modules.payroll.remarks import remark_default

SCHEMA = "payroll"

#: Receipt numbers never repeat under concurrent inserts: one sequence per kind.
receipt_sal_seq = Sequence("receipt_sal_seq", schema=SCHEMA, metadata=Base.metadata)
receipt_adv_seq = Sequence("receipt_adv_seq", schema=SCHEMA, metadata=Base.metadata)


class PayType(enum.StrEnum):
    monthly = "monthly"
    daily = "daily"


class PaymentKind(enum.StrEnum):
    salary = "salary"
    advance = "advance"


class PaymentSource(enum.StrEnum):
    scan = "scan"
    account = "account"


def _enum(kind: type[enum.StrEnum], name: str) -> Enum:
    return Enum(kind, name=name, schema=SCHEMA, values_callable=_enum_values)


class SalaryHistory(Base):
    """One row per salary revision; the row in force for a BS month is the latest one whose
    ``effective_ad`` is on or before the month's last day. Monthly: ``basic + allowances`` is
    the salary per month. Daily: ``basic`` is the wage per day."""

    __tablename__ = "salary_history"
    __table_args__ = (
        CheckConstraint("basic >= 0 AND allowances >= 0 AND ot_rate >= 0", name="amounts"),
        Index("ix_salary_history_employee_effective", "employee_id", "effective_ad"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("core.employees.id", ondelete="RESTRICT"), nullable=False
    )
    pay_type: Mapped[PayType] = mapped_column(_enum(PayType, "pay_type"), nullable=False)
    basic: Mapped[int] = mapped_column(Integer, nullable=False)
    allowances: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    #: Rupees per overtime hour (default salary / 30 / 8, daily wage / 8; editable).
    ot_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    #: How this person is usually paid (``admin.payment_modes``; Cash = 1). Null = Cash.
    default_payment_mode_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin.payment_modes.id", ondelete="RESTRICT")
    )
    effective_ad: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    employee: Mapped[Employee] = relationship(lazy="selectin")

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<SalaryHistory {self.employee_id} {self.pay_type} {self.basic} "
            f"from {self.effective_ad}>"
        )


class Payment(Base):
    """A salary or advance payment. It counts for the BS month ``for_year`` / ``for_month``
    (sent explicitly: Ashoj's salary paid on Kartik 2 counts for Ashoj), whatever ``date`` is."""

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("for_month BETWEEN 1 AND 12", name="for_month_range"),
        CheckConstraint("(voided_at IS NULL) = (void_reason IS NULL)", name="void_reason"),
        Index("ix_payments_employee_month", "employee_id", "for_year", "for_month"),
        # A salary payment group shares one receipt number, one row per month (payroll_0003).
        Index("uq_payments_receipt_month", "receipt_no", "for_year", "for_month", unique=True),
        Index("ix_payments_payment_group_id", "payment_group_id"),
        Index("ix_payments_date", "date"),
        Index("ix_payments_branch_date", "branch_id", "date"),
        Index("ix_payments_payment_mode_id", "payment_mode_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: "SAL-0410" / "ADV-0412" from the per-kind sequences, assigned in the insert transaction.
    #: The rows of one salary payment group share it (one per month).
    receipt_no: Mapped[str] = mapped_column(String(16), nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("core.employees.id", ondelete="RESTRICT"), nullable=False
    )
    #: The employee's branch at the moment of payment (set by the server, never from a client).
    #: Payment reports, the salary report's paid totals and their exports filter on it, so a
    #: transfer leaves earlier payments with the branch that made them.
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("core.branches.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[PaymentKind] = mapped_column(_enum(PaymentKind, "payment_kind"), nullable=False)
    for_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    for_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    payment_mode_id: Mapped[int] = mapped_column(
        ForeignKey("admin.payment_modes.id", ondelete="RESTRICT"), nullable=False
    )
    #: Calendar day of the payment (AD); the BS twin is derived on output.
    date: Mapped[date] = mapped_column(Date, nullable=False)
    paid_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: Bank / cheque reference; null for cash.
    reference: Mapped[str | None] = mapped_column(String(80))
    #: Written by the server when the payment is created (remarks.py), identical on every row of
    #: a group, never accepted from a client and never edited.
    system_remark: Mapped[str] = mapped_column(Text, nullable=False, default=remark_default)
    #: The human note (PATCH /payments/{id}/note, salary_advances; audit-logged); identical on
    #: every row of a group. Null = no note.
    note: Mapped[str | None] = mapped_column(Text)
    note_updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("core.users.id", ondelete="SET NULL")
    )
    note_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[PaymentSource] = mapped_column(
        _enum(PaymentSource, "payment_source"), nullable=False
    )
    recorded_by: Mapped[int | None] = mapped_column(
        ForeignKey("core.users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: One "Pay salary" split oldest month first: every row of it carries the id of its first row.
    #: Null for single payments (advances, the older per-month salary payments).
    payment_group_id: Mapped[int | None] = mapped_column(Integer)
    #: Voided payments (admin only, with a reason, never undone) stay on record but count for
    #: nothing: not paid, not due, not in totals, exports or the payments-per-month contract.
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    void_reason: Mapped[str | None] = mapped_column(String(200))

    employee: Mapped[Employee] = relationship(lazy="selectin")
    branch: Mapped[Branch] = relationship(lazy="selectin")
    recorder: Mapped[User | None] = relationship(lazy="selectin", foreign_keys=[recorded_by])
    voider: Mapped[User | None] = relationship(lazy="selectin", foreign_keys=[voided_by])
    note_editor: Mapped[User | None] = relationship(lazy="selectin", foreign_keys=[note_updated_by])

    @property
    def voided(self) -> bool:
        return self.voided_at is not None

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<Payment {self.receipt_no} {self.kind} {self.amount} "
            f"for {self.for_year}-{self.for_month:02d}>"
        )


class PhotoToken(Base):
    """A single-use, 15-minute link the QR code encodes so a phone can take the employee's photo
    without a session."""

    __tablename__ = "photo_tokens"
    __table_args__ = {"schema": SCHEMA}

    token: Mapped[str] = mapped_column(String(48), primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("core.employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
