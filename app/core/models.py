"""Core tables (Postgres schema ``core``).

Only the ``main`` branch may change this schema. Module worktrees reference these tables with
cross-schema foreign keys, e.g. ``ForeignKey("core.employees.id")``.

Names (branches, departments) are unique case- and whitespace-insensitively: a generated
``name_norm`` column carries the normalised value and a unique constraint sits on it.
:func:`normalize_name` is the Python twin of that SQL expression - use it for lookups.
"""

from __future__ import annotations

import enum
import re
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

SCHEMA = "core"

# SQL and Python implementations of the same normalisation: collapse runs of whitespace to one
# space, trim, lower-case. Keep the two in sync - the database enforces uniqueness on it.
NAME_NORM_SQL = r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))"
_WS = re.compile(r"[ \t\n\r\f\v]+")


def normalize_name(value: str) -> str:
    """Python twin of :data:`NAME_NORM_SQL` (``"  Main   Branch "`` -> ``"main branch"``)."""
    return _WS.sub(" ", value).strip(" ").lower()


def normalize_username(value: str) -> str:
    return value.strip().lower()


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class Role(enum.StrEnum):
    admin = "admin"
    manager = "manager"
    store_keeper = "store_keeper"
    staff = "staff"


ROLE_LABELS: dict[str, str] = {
    Role.admin: "Admin",
    Role.manager: "Manager",
    Role.store_keeper: "Store keeper",
    Role.staff: "Staff",
}


class EmployeeStatus(enum.StrEnum):
    active = "active"
    inactive = "inactive"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Branch(Base):
    __tablename__ = "branches"
    __table_args__ = (
        UniqueConstraint("name_norm", name="uq_branches_name_norm"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name_norm: Mapped[str] = mapped_column(
        String(120), Computed(NAME_NORM_SQL, persisted=True), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Branch {self.id} {self.name!r}>"


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("name_norm", name="uq_departments_name_norm"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name_norm: Mapped[str] = mapped_column(
        String(120), Computed(NAME_NORM_SQL, persisted=True), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Department {self.id} {self.name!r}>"


# Employee codes are assigned by the database: E-001, E-002, ... (lpad to 3 digits, grows past 999).
employee_code_seq = Sequence("employee_code_seq", schema=SCHEMA, metadata=Base.metadata)
EMPLOYEE_CODE_DEFAULT_SQL = "'E-' || lpad(nextval('core.employee_code_seq')::text, 3, '0')"


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = {"schema": SCHEMA}
    __mapper_args__ = {"eager_defaults": True}  # fetch the DB-generated code with RETURNING

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(
        String(16), nullable=False, unique=True, server_default=text(EMPLOYEE_CODE_DEFAULT_SQL)
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("core.branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("core.departments.id", ondelete="RESTRICT"), index=True
    )
    designation: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(
            EmployeeStatus,
            name="employee_status",
            schema=SCHEMA,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=EmployeeStatus.active,
        server_default="active",
    )
    photo_path: Mapped[str | None] = mapped_column(String(255))

    branch: Mapped[Branch] = relationship(lazy="selectin")
    department: Mapped[Department | None] = relationship(lazy="selectin")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Employee {self.code} {self.full_name!r}>"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)  # lower-cased
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", schema=SCHEMA, values_callable=_enum_values),
        nullable=False,
        default=Role.staff,
        server_default="staff",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("core.employees.id", ondelete="SET NULL"), index=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee: Mapped[Employee | None] = relationship(lazy="selectin")

    @property
    def role_label(self) -> str:
        return ROLE_LABELS.get(self.role, str(self.role))

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.id} {self.username!r} {self.role}>"


class Setting(Base):
    """Key/value app settings. Seeded keys: late_after, weekly_off, company_name."""

    __tablename__ = "settings"
    __table_args__ = {"schema": SCHEMA}

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_entity", "module", "entity", "entity_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("core.users.id", ondelete="SET NULL"))
    module: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
