"""core: users.is_super_admin - the one account that may change locked (past) attendance

At most ONE user can hold the flag (partial unique index). It is set only from the server
command line (``python -m app.cli set-super-admin``, deploy/set-super-admin.sh); no API or
screen writes it.

Revision ID: core_0008
Revises: core_0007
Create Date: 2026-11-12 09:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "core_0008"
down_revision = "core_0007"
branch_labels = None
depends_on = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_super_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    op.create_index(
        "ux_users_one_super_admin",
        "users",
        ["is_super_admin"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("is_super_admin"),
    )


def downgrade() -> None:
    op.drop_index("ux_users_one_super_admin", table_name="users", schema=SCHEMA)
    op.drop_column("users", "is_super_admin", schema=SCHEMA)
