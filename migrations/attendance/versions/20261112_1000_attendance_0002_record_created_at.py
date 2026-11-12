"""attendance: records.created_at - when a day's mark was FIRST saved

A mark can be changed or removed for 24 hours from this moment (editing does not move it);
after that, and on any past day, only the super admin can change attendance. ``marked_at`` keeps
moving with every change, so it cannot carry the rule.

Existing rows get the time of their first ``record_changes`` row (the insert), else
``marked_at``.

Revision ID: attendance_0002
Revises: attendance_0001
Create Date: 2026-11-12 10:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "attendance_0002"
down_revision = "attendance_0001"
branch_labels = None
depends_on = None

SCHEMA = "attendance"


def upgrade() -> None:
    op.add_column(
        "records",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        """
        UPDATE attendance.records r
        SET created_at = COALESCE(
            (
                SELECT min(c.changed_at)
                FROM attendance.record_changes c
                WHERE c.record_id = r.id AND c.old_status IS NULL
            ),
            r.marked_at
        )
        """
    )
    op.alter_column(
        "records", "created_at", nullable=False, server_default=sa.text("now()"), schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_column("records", "created_at", schema=SCHEMA)
