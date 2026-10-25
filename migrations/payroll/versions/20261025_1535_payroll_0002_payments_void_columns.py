"""payroll: void payments - voided_at, voided_by, void_reason

A voided payment stays on record (and keeps its receipt number, never reused) but counts for
nothing. Voiding is admin only, needs a reason and cannot be undone (POST /payments/{id}/void).

Revision ID: payroll_0002
Revises: payroll_0001
Create Date: 2026-10-25 15:35

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "payroll_0002"
down_revision = "payroll_0001"
branch_labels = None
depends_on = None

SCHEMA = "payroll"


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA
    )
    op.add_column("payments", sa.Column("voided_by", sa.Integer(), nullable=True), schema=SCHEMA)
    op.add_column(
        "payments", sa.Column("void_reason", sa.String(length=200), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        op.f("fk_payments_voided_by_users"),
        "payments",
        "users",
        ["voided_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        op.f("ck_payments_void_reason"),
        "payments",
        "(voided_at IS NULL) = (void_reason IS NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_payments_void_reason"), "payments", schema=SCHEMA, type_="check")
    op.drop_constraint(
        op.f("fk_payments_voided_by_users"), "payments", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("payments", "void_reason", schema=SCHEMA)
    op.drop_column("payments", "voided_by", schema=SCHEMA)
    op.drop_column("payments", "voided_at", schema=SCHEMA)
