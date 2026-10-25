"""payroll: salary_history, payments, photo_tokens, receipt sequences

Employees stay in core.employees (core_0006 added the profile columns). payments and
salary_history reference admin.payment_modes, so the admin section must be at admin_0002 or
later before this runs: `make migrate` orders core -> admin -> other modules (README).

Revision ID: payroll_0001
Revises:
Create Date: 2026-10-26 10:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "payroll_0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "payroll"


def _require(table: str) -> None:
    exists = op.get_bind().execute(sa.text("SELECT to_regclass(:name)"), {"name": table}).scalar()
    if exists is None:
        raise RuntimeError(
            f"{table} does not exist: run `alembic -n core upgrade head` and "
            "`alembic -n admin upgrade head` before `alembic -n payroll upgrade head` "
            "(see README, 'One database, one Alembic section per module')."
        )


def upgrade() -> None:
    _require("core.employees")
    _require("admin.payment_modes")
    op.execute(
        sa.schema.CreateSequence(sa.Sequence("receipt_sal_seq", schema=SCHEMA), if_not_exists=True)
    )
    op.execute(
        sa.schema.CreateSequence(sa.Sequence("receipt_adv_seq", schema=SCHEMA), if_not_exists=True)
    )

    pay_type = postgresql.ENUM("monthly", "daily", name="pay_type", schema=SCHEMA)
    payment_kind = postgresql.ENUM("salary", "advance", name="payment_kind", schema=SCHEMA)
    payment_source = postgresql.ENUM("scan", "account", name="payment_source", schema=SCHEMA)

    op.create_table(
        "salary_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("pay_type", pay_type, nullable=False),
        sa.Column("basic", sa.Integer(), nullable=False),
        sa.Column("allowances", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ot_rate", sa.Integer(), nullable=False),
        sa.Column("default_payment_mode_id", sa.Integer(), nullable=True),
        sa.Column("effective_ad", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "basic >= 0 AND allowances >= 0 AND ot_rate >= 0", name="ck_salary_history_amounts"
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name="fk_salary_history_employee_id_employees",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["default_payment_mode_id"],
            ["admin.payment_modes.id"],
            name="fk_salary_history_default_payment_mode_id_payment_modes",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["core.users.id"],
            name="fk_salary_history_created_by_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_salary_history"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_salary_history_employee_effective",
        "salary_history",
        ["employee_id", "effective_ad"],
        schema=SCHEMA,
    )

    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("receipt_no", sa.String(length=16), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("kind", payment_kind, nullable=False),
        sa.Column("for_year", sa.SmallInteger(), nullable=False),
        sa.Column("for_month", sa.SmallInteger(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("payment_mode_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "paid_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("reference", sa.String(length=80), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("source", payment_source, nullable=False),
        sa.Column("recorded_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("amount > 0", name="ck_payments_amount_positive"),
        sa.CheckConstraint("for_month BETWEEN 1 AND 12", name="ck_payments_for_month_range"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name="fk_payments_employee_id_employees",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["payment_mode_id"],
            ["admin.payment_modes.id"],
            name="fk_payments_payment_mode_id_payment_modes",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by"],
            ["core.users.id"],
            name="fk_payments_recorded_by_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_payments"),
        sa.UniqueConstraint("receipt_no", name="uq_payments_receipt_no"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_payments_employee_month",
        "payments",
        ["employee_id", "for_year", "for_month"],
        schema=SCHEMA,
    )
    op.create_index("ix_payments_date", "payments", ["date"], schema=SCHEMA)
    op.create_index("ix_payments_payment_mode_id", "payments", ["payment_mode_id"], schema=SCHEMA)

    op.create_table(
        "photo_tokens",
        sa.Column("token", sa.String(length=48), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name="fk_photo_tokens_employee_id_employees",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["core.users.id"],
            name="fk_photo_tokens_created_by_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("token", name="pk_photo_tokens"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_payroll_photo_tokens_employee_id", "photo_tokens", ["employee_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index("ix_payroll_photo_tokens_employee_id", table_name="photo_tokens", schema=SCHEMA)
    op.drop_table("photo_tokens", schema=SCHEMA)
    op.drop_index("ix_payments_payment_mode_id", table_name="payments", schema=SCHEMA)
    op.drop_index("ix_payments_date", table_name="payments", schema=SCHEMA)
    op.drop_index("ix_payments_employee_month", table_name="payments", schema=SCHEMA)
    op.drop_table("payments", schema=SCHEMA)
    op.drop_index(
        "ix_salary_history_employee_effective", table_name="salary_history", schema=SCHEMA
    )
    op.drop_table("salary_history", schema=SCHEMA)
    for name in ("payment_source", "payment_kind", "pay_type"):
        op.execute(f"DROP TYPE IF EXISTS {SCHEMA}.{name}")
    op.execute(
        sa.schema.DropSequence(sa.Sequence("receipt_adv_seq", schema=SCHEMA), if_exists=True)
    )
    op.execute(
        sa.schema.DropSequence(sa.Sequence("receipt_sal_seq", schema=SCHEMA), if_exists=True)
    )
