"""Admin module tables (Postgres schema ``admin``).

Core owns ``core.users``; this schema adds what the admin screens manage on top of it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Computed,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import NAME_NORM_SQL, TimestampMixin
from app.db import Base

SCHEMA = "admin"


class UserAccess(Base):
    """Per-user settings on top of ``core.users``: the branch they work in (``NULL`` = all
    branches, the rule for admins) and permission overrides (``NULL`` = the role preset,
    otherwise the full ``{permission: bool}`` map - see :mod:`app.modules.admin.permissions`).
    A user without a row behaves like ``branch_id=NULL, access=NULL``."""

    __tablename__ = "user_access"
    __table_args__ = {"schema": SCHEMA}

    user_id: Mapped[int] = mapped_column(
        ForeignKey("core.users.id", ondelete="CASCADE"), primary_key=True
    )
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("core.branches.id", ondelete="SET NULL"), index=True
    )
    access: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserAccess user={self.user_id} branch={self.branch_id} custom={self.access}>"


class PaymentMode(Base, TimestampMixin):
    """How salary and advances can be paid (design/final/AdminPaymentModes.dc.html). ``Cash``
    is seeded by migration admin_0002 with ``is_builtin`` and can neither be edited nor turned
    off; the others (bank / wallet / qr / cheque) are admin-managed. Payroll reads the active
    ones and stores ``payment_mode_id`` on each payment, so a mode is never deleted - turning
    it off hides it from new payments without touching old ones."""

    __tablename__ = "payment_modes"
    __table_args__ = (
        UniqueConstraint("name_norm", name="uq_payment_modes_name_norm"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name_norm: Mapped[str] = mapped_column(
        String(80), Computed(NAME_NORM_SQL, persisted=True), nullable=False
    )
    details: Mapped[str | None] = mapped_column(String(120))
    use_salary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    use_advance: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PaymentMode {self.id} {self.name!r} {self.type} active={self.active}>"
