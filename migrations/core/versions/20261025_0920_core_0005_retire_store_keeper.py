"""core: retire the store_keeper role (stock module discontinued) - users become staff

The ``user_role`` enum keeps the value (dropping an enum member is not possible in place);
the application no longer offers it and this migration moves existing rows to ``staff``.

Revision ID: core_0005
Revises: core_0004
Create Date: 2026-10-25 09:20

"""

from __future__ import annotations

from alembic import op

revision = "core_0005"
down_revision = "core_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE core.users SET role = 'staff' WHERE role = 'store_keeper'")


def downgrade() -> None:
    # Nothing to restore: which staff users used to be store keepers is not recorded.
    pass
