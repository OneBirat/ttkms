"""payroll: payslip_prints - remember that a pay slip was printed

One row per employee and BS month every time the Salary report sends a slip to the printer
(kept as history). The report shows "Slip printed" from the latest row.

Revision ID: payroll_0006
Revises: payroll_0005
Create Date: 2026-11-12 19:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "payroll_0006"
down_revision = "payroll_0005"
branch_labels = None
depends_on = None

SCHEMA = "payroll"


def upgrade() -> None:
    op.create_table(
        "payslip_prints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("bs_year", sa.SmallInteger(), nullable=False),
        sa.Column("bs_month", sa.SmallInteger(), nullable=False),
        sa.Column(
            "printed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("printed_by", sa.Integer(), nullable=True),
        sa.CheckConstraint("bs_month BETWEEN 1 AND 12", name="ck_payslip_prints_bs_month_range"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["core.employees.id"],
            name="fk_payslip_prints_employee_id_employees",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["printed_by"],
            ["core.users.id"],
            name="fk_payslip_prints_printed_by_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_payslip_prints"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_payslip_prints_employee_month",
        "payslip_prints",
        ["employee_id", "bs_year", "bs_month"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_payslip_prints_employee_month", "payslip_prints", schema=SCHEMA)
    op.drop_table("payslip_prints", schema=SCHEMA)
