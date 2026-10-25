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
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
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


_PHONE_STRIP = re.compile(r"[\s\-().]+")
#: A Nepali mobile number as stored: ten digits starting with 97 or 98.
PHONE_RE = re.compile(r"^9[78]\d{8}$")


def normalize_phone(value: str) -> str:
    """``"+977 98-4100 0001"`` -> ``"9841000001"``: drop spaces/punctuation and the country
    code. The result is only a *valid* login phone when it matches :data:`PHONE_RE`."""
    digits = _PHONE_STRIP.sub("", value.strip())
    if digits.startswith("+977"):
        digits = digits[4:]
    elif digits.startswith("977") and len(digits) == 13:
        digits = digits[3:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits


def is_phone(value: str) -> bool:
    """True when a login identifier is a phone number rather than a username."""
    return PHONE_RE.match(normalize_phone(value)) is not None


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class Role(enum.StrEnum):
    """Admin / Manager / Staff. The database enum still holds the retired ``store_keeper``
    value (stock module discontinued); migration core_0005 moved those users to staff."""

    admin = "admin"
    manager = "manager"
    staff = "staff"


ROLE_LABELS: dict[str, str] = {
    Role.admin: "Admin",
    Role.manager: "Manager",
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


# Employee codes are assigned by the database function core.next_employee_code(): E-001, E-002,
# ... zero-padded to at least 3 digits and growing past 999 (E-1000).
employee_code_seq = Sequence("employee_code_seq", schema=SCHEMA, metadata=Base.metadata)
EMPLOYEE_CODE_DEFAULT_SQL = "core.next_employee_code()"


#: The Code 128 value printed on the staff card: "TTK-E001" for code "E-001" (one format
#: everywhere; the legacy "TTK-E-001" form is still accepted by lookups).
BARCODE_SQL = "'TTK-' || replace(code, '-', '')"


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = (
        # A phone number identifies one *active* employee; former staff may share it.
        Index(
            "ux_employees_active_phone",
            "phone",
            unique=True,
            postgresql_where=text("status = 'active' AND phone IS NOT NULL"),
        ),
        {"schema": SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # fetch the DB-generated code with RETURNING

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(
        String(16), nullable=False, unique=True, server_default=text(EMPLOYEE_CODE_DEFAULT_SQL)
    )
    barcode: Mapped[str] = mapped_column(
        String(24), Computed(BARCODE_SQL, persisted=True), nullable=False, unique=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Name in Devanagari (optional; payslips and the scan flow's spoken confirmation).
    full_name_np: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32))
    #: Extra contact (family member, second number).
    phone_alt: Mapped[str | None] = mapped_column(String(32))
    address: Mapped[str | None] = mapped_column(String(200))
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
    #: Joining date (AD); the BS twin is derived on output (docs/bs-calendar.md).
    joined_ad: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    #: When the employee was deactivated (status -> inactive); null while active.
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    branch: Mapped[Branch] = relationship(lazy="selectin")
    department: Mapped[Department | None] = relationship(lazy="selectin")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Employee {self.code} {self.full_name!r}>"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        # One login per employee (the employee's "login" in People).
        Index(
            "ux_users_employee_id",
            "employee_id",
            unique=True,
            postgresql_where=text("employee_id IS NOT NULL"),
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)  # lower-cased
    #: Optional second login identifier, normalised digits only ("9841000001").
    phone: Mapped[str | None] = mapped_column(String(10), unique=True)
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
    #: Set when an admin issued a temporary password: the user must pick their own one before
    #: any other API call succeeds (see ``app.core.auth``).
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
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
