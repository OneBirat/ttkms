"""core: employee codes from core.next_employee_code() (zero-padded, grows past 999)

Revision ID: core_0002
Revises: core_0001
Create Date: 2026-10-23 00:10

"""

from __future__ import annotations

from alembic import op

revision = "core_0002"
down_revision = "core_0001"
branch_labels = None
depends_on = None

OLD_DEFAULT = (
    "('E-'::text || lpad((nextval('core.employee_code_seq'::regclass))::text, 3, '0'::text))"
)


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION core.next_employee_code() RETURNS text
        LANGUAGE sql VOLATILE AS $$
            SELECT 'E-' || lpad(n::text, greatest(3, length(n::text)), '0')
            FROM nextval('core.employee_code_seq') AS n
        $$
        """
    )
    op.execute("ALTER TABLE core.employees ALTER COLUMN code SET DEFAULT core.next_employee_code()")


def downgrade() -> None:
    op.execute(f"ALTER TABLE core.employees ALTER COLUMN code SET DEFAULT {OLD_DEFAULT}")
    op.execute("DROP FUNCTION core.next_employee_code()")
