"""core: users.phone - optional second login identifier (unique, normalised digits)

Revision ID: core_0003
Revises: core_0002
Create Date: 2026-10-25 09:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "core_0003"
down_revision = "core_0002"
branch_labels = None
depends_on = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=10), nullable=True), schema=SCHEMA)
    op.create_unique_constraint("uq_users_phone", "users", ["phone"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_constraint("uq_users_phone", "users", schema=SCHEMA, type_="unique")
    op.drop_column("users", "phone", schema=SCHEMA)
