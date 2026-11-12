"""attendance: record_changes.reason and is_override - the super admin's changes to locked days

``record_changes`` is the history of every mark (who, when, old -> new). A change the super
admin makes on a past day is an override: it carries the reason they gave (required, at least 5
characters) and ``is_override = true``. Ordinary changes keep ``reason = ''``.

Revision ID: attendance_0003
Revises: attendance_0002
Create Date: 2026-11-12 11:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "attendance_0003"
down_revision = "attendance_0002"
branch_labels = None
depends_on = None

SCHEMA = "attendance"


def upgrade() -> None:
    op.add_column(
        "record_changes",
        sa.Column("reason", sa.String(length=300), server_default=sa.text("''"), nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "record_changes",
        sa.Column("is_override", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_record_changes_override_reason"),
        "record_changes",
        "NOT is_override OR char_length(btrim(reason)) >= 5",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_record_changes_override_reason"), "record_changes", schema=SCHEMA, type_="check"
    )
    op.drop_column("record_changes", "is_override", schema=SCHEMA)
    op.drop_column("record_changes", "reason", schema=SCHEMA)
