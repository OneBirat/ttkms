"""admin: user_access - branch and per-user permission overrides on top of core.users

Revision ID: admin_0001
Revises:
Create Date: 2026-10-25 10:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "admin_0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "admin"


def upgrade() -> None:
    op.create_table(
        "user_access",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("access", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["core.users.id"], name="fk_user_access_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["core.branches.id"],
            name="fk_user_access_branch_id_branches",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("user_id", name="pk_user_access"),
        schema=SCHEMA,
    )
    op.create_index("ix_admin_user_access_branch_id", "user_access", ["branch_id"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_admin_user_access_branch_id", table_name="user_access", schema=SCHEMA)
    op.drop_table("user_access", schema=SCHEMA)
