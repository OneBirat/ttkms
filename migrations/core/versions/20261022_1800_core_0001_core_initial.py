"""core: initial tables (branches, departments, employees, users, settings, audit_log)

Revision ID: core_0001
Revises:
Create Date: 2026-10-22 18:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateSequence, DropSequence

revision = "core_0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "core"
# Keep identical to app.core.models.NAME_NORM_SQL
NAME_NORM_SQL = r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))"
EMPLOYEE_CODE_DEFAULT_SQL = "'E-' || lpad(nextval('core.employee_code_seq')::text, 3, '0')"

user_role = postgresql.ENUM(
    "admin", "manager", "store_keeper", "staff", name="user_role", schema=SCHEMA, create_type=False
)
employee_status = postgresql.ENUM(
    "active", "inactive", name="employee_status", schema=SCHEMA, create_type=False
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    employee_status.create(bind, checkfirst=True)
    op.execute(CreateSequence(sa.Sequence("employee_code_seq", schema=SCHEMA), if_not_exists=True))

    for table in ("branches", "departments"):
        op.create_table(
            table,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column(
                "name_norm",
                sa.String(length=120),
                sa.Computed(NAME_NORM_SQL, persisted=True),
                nullable=False,
            ),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
            sa.UniqueConstraint("name", name=f"uq_{table}_name"),
            sa.UniqueConstraint("name_norm", name=f"uq_{table}_name_norm"),
            schema=SCHEMA,
        )

    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "code",
            sa.String(length=16),
            server_default=sa.text(EMPLOYEE_CODE_DEFAULT_SQL),
            nullable=False,
        ),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("designation", sa.String(length=80), nullable=True),
        sa.Column("status", employee_status, server_default="active", nullable=False),
        sa.Column("photo_path", sa.String(length=255), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["core.branches.id"],
            name="fk_employees_branch_id_branches",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["core.departments.id"],
            name="fk_employees_department_id_departments",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_employees"),
        sa.UniqueConstraint("code", name="uq_employees_code"),
        schema=SCHEMA,
    )
    op.create_index("ix_core_employees_branch_id", "employees", ["branch_id"], schema=SCHEMA)
    op.create_index(
        "ix_core_employees_department_id", "employees", ["department_id"], schema=SCHEMA
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("role", user_role, server_default="staff", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name="fk_users_employee_id_employees",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
        schema=SCHEMA,
    )
    op.create_index("ix_core_users_employee_id", "users", ["employee_id"], schema=SCHEMA)

    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("key", name="pk_settings"),
        schema=SCHEMA,
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("module", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["core.users.id"], name="fk_audit_log_user_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_log"),
        schema=SCHEMA,
    )
    op.create_index("ix_core_audit_log_at", "audit_log", ["at"], schema=SCHEMA)
    op.create_index(
        "ix_audit_log_entity", "audit_log", ["module", "entity", "entity_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_table("audit_log", schema=SCHEMA)
    op.drop_table("settings", schema=SCHEMA)
    op.drop_table("users", schema=SCHEMA)
    op.drop_table("employees", schema=SCHEMA)
    op.drop_table("departments", schema=SCHEMA)
    op.drop_table("branches", schema=SCHEMA)
    op.execute(DropSequence(sa.Sequence("employee_code_seq", schema=SCHEMA), if_exists=True))
    bind = op.get_bind()
    employee_status.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
