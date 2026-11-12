"""attendance: holidays and holiday_branches - the public holiday calendar

One dated entry per public holiday (AD date, no recurrence), for every branch
(``all_branches``) or the branches listed in ``holiday_branches``. Holidays are applied when
attendance and pay are read; no attendance row is written for them.

Revision ID: attendance_0005
Revises: attendance_0004
Create Date: 2026-11-12 15:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "attendance_0005"
down_revision = "attendance_0004"
branch_labels = None
depends_on = None

SCHEMA = "attendance"


def upgrade() -> None:
    op.create_table(
        "holidays",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("all_branches", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_paid", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["core.users.id"],
            name=op.f("fk_holidays_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_holidays")),
        schema=SCHEMA,
    )
    op.create_index("ix_holidays_date", "holidays", ["date"], schema=SCHEMA)
    op.create_table(
        "holiday_branches",
        sa.Column("holiday_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["holiday_id"],
            [f"{SCHEMA}.holidays.id"],
            name=op.f("fk_holiday_branches_holiday_id_holidays"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["core.branches.id"],
            name=op.f("fk_holiday_branches_branch_id_branches"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("holiday_id", "branch_id", name=op.f("pk_holiday_branches")),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("holiday_branches", schema=SCHEMA)
    op.drop_index("ix_holidays_date", table_name="holidays", schema=SCHEMA)
    op.drop_table("holidays", schema=SCHEMA)
