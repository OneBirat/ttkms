"""payroll: salary payment groups - payment_group_id, receipt number per month

One "Pay salary" (POST /salary-payments) settles the salary due oldest month first: one payment
row per month, all sharing one receipt number and a ``payment_group_id`` (the id of the group's
first row). The receipt number is therefore unique per (receipt_no, for_year, for_month) instead
of on its own. Voiding any row of a group voids the whole group.

Revision ID: payroll_0003
Revises: payroll_0002
Create Date: 2026-10-25 18:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "payroll_0003"
down_revision = "payroll_0002"
branch_labels = None
depends_on = None

SCHEMA = "payroll"


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("payment_group_id", sa.Integer(), nullable=True), schema=SCHEMA
    )
    op.create_index(
        op.f("ix_payments_payment_group_id"), "payments", ["payment_group_id"], schema=SCHEMA
    )
    op.drop_constraint(op.f("uq_payments_receipt_no"), "payments", schema=SCHEMA, type_="unique")
    op.create_index(
        op.f("uq_payments_receipt_month"),
        "payments",
        ["receipt_no", "for_year", "for_month"],
        unique=True,
        schema=SCHEMA,
    )


def downgrade() -> None:
    # Fails while a receipt number is shared by a group's rows - void / merge those first.
    op.drop_index(op.f("uq_payments_receipt_month"), "payments", schema=SCHEMA)
    op.create_unique_constraint(
        op.f("uq_payments_receipt_no"), "payments", ["receipt_no"], schema=SCHEMA
    )
    op.drop_index(op.f("ix_payments_payment_group_id"), "payments", schema=SCHEMA)
    op.drop_column("payments", "payment_group_id", schema=SCHEMA)
