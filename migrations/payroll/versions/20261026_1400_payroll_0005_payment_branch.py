"""payroll: payments.branch_id - the branch at the moment of payment

Payment reports, the salary report's paid totals and their exports used the employee's CURRENT
branch, so transferring someone moved all their old payments to the new branch. Each payment now
records the employee's branch when it is made (FK core.branches, NOT NULL). Existing rows are
filled from the employee's current branch - the only branch known for them.

Revision ID: payroll_0005
Revises: payroll_0004
Create Date: 2026-10-26 14:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "payroll_0005"
down_revision = "payroll_0004"
branch_labels = None
depends_on = None

SCHEMA = "payroll"


def upgrade() -> None:
    op.add_column("payments", sa.Column("branch_id", sa.Integer(), nullable=True), schema=SCHEMA)
    op.execute(
        f"""
        UPDATE {SCHEMA}.payments p
        SET branch_id = e.branch_id
        FROM core.employees e
        WHERE e.id = p.employee_id
        """
    )
    op.alter_column("payments", "branch_id", nullable=False, schema=SCHEMA)
    op.create_foreign_key(
        "fk_payments_branch_id_branches",
        "payments",
        "branches",
        ["branch_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema="core",
        ondelete="RESTRICT",
    )
    op.create_index("ix_payments_branch_date", "payments", ["branch_id", "date"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_payments_branch_date", "payments", schema=SCHEMA)
    op.drop_constraint(
        "fk_payments_branch_id_branches", "payments", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("payments", "branch_id", schema=SCHEMA)
