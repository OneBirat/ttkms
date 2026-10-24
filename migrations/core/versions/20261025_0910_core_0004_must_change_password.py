"""core: users.must_change_password - forces a new password after an admin reset

Revision ID: core_0004
Revises: core_0003
Create Date: 2026-10-25 09:10

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "core_0004"
down_revision = "core_0003"
branch_labels = None
depends_on = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password", schema=SCHEMA)
