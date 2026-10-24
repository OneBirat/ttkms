"""admin: payment_modes - Cash (built in, always on) plus admin-managed bank/wallet/QR/cheque

Revision ID: admin_0002
Revises: admin_0001
Create Date: 2026-10-25 11:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "admin_0002"
down_revision = "admin_0001"
branch_labels = None
depends_on = None

SCHEMA = "admin"
# Keep identical to app.core.models.NAME_NORM_SQL
NAME_NORM_SQL = r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))"


def upgrade() -> None:
    op.create_table(
        "payment_modes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column(
            "name_norm",
            sa.String(length=80),
            sa.Computed(NAME_NORM_SQL, persisted=True),
            nullable=False,
        ),
        sa.Column("details", sa.String(length=120), nullable=True),
        sa.Column("use_salary", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("use_advance", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_payment_modes"),
        sa.UniqueConstraint("name", name="uq_payment_modes_name"),
        sa.UniqueConstraint("name_norm", name="uq_payment_modes_name_norm"),
        schema=SCHEMA,
    )
    # Cash is id 1 everywhere (payroll defaults payment_mode_id to 1).
    op.execute(
        "INSERT INTO admin.payment_modes (id, type, name, details, use_salary, use_advance, "
        "active, is_builtin) VALUES (1, 'cash', 'Cash', NULL, true, true, true, true)"
    )
    op.execute("SELECT setval(pg_get_serial_sequence('admin.payment_modes', 'id'), 1)")


def downgrade() -> None:
    op.drop_table("payment_modes", schema=SCHEMA)
