"""core: users.active_branch_id - the ONE branch the whole app works on for a user

Every branch-aware screen and endpoint uses it when no branch is asked for. Users with
``see_other_branches`` switch it (PATCH /api/auth/me/active-branch); everyone else is always
held to their own branch (``admin.user_access.branch_id``) whatever is stored here.

Existing users get their own branch from ``admin.user_access`` when the admin module's table is
there (it is migrated after core, so on a fresh database it is not yet), else the first active
branch (A-Z).

Revision ID: core_0007
Revises: core_0006
Create Date: 2026-10-26 15:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "core_0007"
down_revision = "core_0006"
branch_labels = None
depends_on = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("active_branch_id", sa.Integer(), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        "fk_users_active_branch_id_branches",
        "users",
        "branches",
        ["active_branch_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT to_regclass('admin.user_access') IS NOT NULL")):
        op.execute(
            """
            UPDATE core.users u
            SET active_branch_id = a.branch_id
            FROM admin.user_access a
            WHERE a.user_id = u.id AND a.branch_id IS NOT NULL
            """
        )
    op.execute(
        """
        UPDATE core.users
        SET active_branch_id = (
            SELECT id FROM core.branches WHERE is_active ORDER BY name, id LIMIT 1
        )
        WHERE active_branch_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_users_active_branch_id_branches", "users", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("users", "active_branch_id", schema=SCHEMA)
