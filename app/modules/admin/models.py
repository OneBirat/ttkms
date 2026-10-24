"""Admin module tables (Postgres schema ``admin``).

Core owns ``core.users``; this schema adds what the admin screens manage on top of it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

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
