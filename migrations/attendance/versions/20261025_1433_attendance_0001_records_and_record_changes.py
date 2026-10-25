"""attendance: records and record_changes

One row per employee per attendance day (AD date in Asia/Kathmandu; unique per employee and
day), P / O / A only, overtime hours > 0 only with O. Saturday (the weekly off) is never stored
unless someone came in. record_changes is the audit trail. References core.employees,
core.branches and core.users only: run after `alembic -n core upgrade head` (`make migrate`
orders core -> admin -> payroll -> attendance).

Revision ID: attendance_0001
Revises:
Create Date: 2026-10-25 14:33

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "attendance_0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "attendance"


def _require(table: str) -> None:
    exists = op.get_bind().execute(sa.text("SELECT to_regclass(:name)"), {"name": table}).scalar()
    if exists is None:
        raise RuntimeError(
            f"{table} does not exist: run `alembic -n core upgrade head` before "
            "`alembic -n attendance upgrade head` (see README)."
        )


def upgrade() -> None:
    _require("core.employees")
    op.create_table(
        "record_changes",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("record_id", sa.BigInteger(), nullable=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("old_status", sa.String(length=1), nullable=True),
        sa.Column("new_status", sa.String(length=1), nullable=True),
        sa.Column("old_hours", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("new_hours", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("old_note", sa.String(length=200), server_default=sa.text("''"), nullable=False),
        sa.Column("new_note", sa.String(length=200), server_default=sa.text("''"), nullable=False),
        sa.Column("source", sa.String(length=6), nullable=False),
        sa.Column("changed_by", sa.Integer(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["changed_by"],
            ["core.users.id"],
            name=op.f("fk_record_changes_changed_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name=op.f("fk_record_changes_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_record_changes")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_record_changes_employee_date",
        "record_changes",
        ["employee_id", "date"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_table(
        "records",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=1), nullable=False),
        sa.Column("overtime_hours", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=6), nullable=False),
        sa.Column("marked_by", sa.Integer(), nullable=True),
        sa.Column(
            "marked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("note", sa.String(length=200), server_default=sa.text("''"), nullable=False),
        sa.CheckConstraint(
            "overtime_hours BETWEEN 0 AND 12 AND (status = 'O') = (overtime_hours > 0)",
            name=op.f("ck_records_overtime_hours"),
        ),
        sa.CheckConstraint("source IN ('manual', 'scan', 'bulk')", name=op.f("ck_records_source")),
        sa.CheckConstraint("status IN ('P', 'O', 'A')", name=op.f("ck_records_status")),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["core.branches.id"],
            name=op.f("fk_records_branch_id_branches"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name=op.f("fk_records_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["marked_by"],
            ["core.users.id"],
            name=op.f("fk_records_marked_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_records")),
        sa.UniqueConstraint("employee_id", "date", name=op.f("uq_records_employee_id_date")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_records_date_branch", "records", ["date", "branch_id"], unique=False, schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index("ix_records_date_branch", table_name="records", schema=SCHEMA)
    op.drop_table("records", schema=SCHEMA)
    op.drop_index("ix_record_changes_employee_date", table_name="record_changes", schema=SCHEMA)
    op.drop_table("record_changes", schema=SCHEMA)
