"""core: employee profile fields for payroll - full_name_np, phone_alt, address, joined_ad,
deactivated_at, the generated barcode ("TTK-E001"), one active employee per phone, one login
per employee

Revision ID: core_0006
Revises: core_0005
Create Date: 2026-10-26 09:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "core_0006"
down_revision = "core_0005"
branch_labels = None
depends_on = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column(
        "employees", sa.Column("full_name_np", sa.String(length=120), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "employees", sa.Column("phone_alt", sa.String(length=32), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "employees", sa.Column("address", sa.String(length=200), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "employees",
        sa.Column("joined_ad", sa.Date(), server_default=sa.func.current_date(), nullable=False),
        schema=SCHEMA,
    )
    # Existing rows: the day they were created is the best joining date we have.
    op.execute(
        "UPDATE core.employees SET joined_ad = (created_at AT TIME ZONE 'Asia/Kathmandu')::date"
    )
    op.add_column(
        "employees",
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        "ALTER TABLE core.employees ADD COLUMN barcode VARCHAR(24) "
        "GENERATED ALWAYS AS ('TTK-' || replace(code, '-', '')) STORED NOT NULL"
    )
    op.create_unique_constraint("uq_employees_barcode", "employees", ["barcode"], schema=SCHEMA)
    op.create_index(
        "ux_employees_active_phone",
        "employees",
        ["phone"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("status = 'active' AND phone IS NOT NULL"),
    )
    op.create_index(
        "ux_users_employee_id",
        "users",
        ["employee_id"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("employee_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_users_employee_id", table_name="users", schema=SCHEMA)
    op.drop_index("ux_employees_active_phone", table_name="employees", schema=SCHEMA)
    op.drop_constraint("uq_employees_barcode", "employees", schema=SCHEMA, type_="unique")
    op.drop_column("employees", "barcode", schema=SCHEMA)
    op.drop_column("employees", "deactivated_at", schema=SCHEMA)
    op.drop_column("employees", "joined_ad", schema=SCHEMA)
    op.drop_column("employees", "address", schema=SCHEMA)
    op.drop_column("employees", "phone_alt", schema=SCHEMA)
    op.drop_column("employees", "full_name_np", schema=SCHEMA)
