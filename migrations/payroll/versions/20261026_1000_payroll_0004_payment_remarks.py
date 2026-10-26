"""payroll: payment system remark + editable note

``system_remark`` (text, NOT NULL) is written by the server when a payment is created
(app/modules/payroll/remarks.py) and never edited; ``note`` becomes the human note (text) with
who / when last changed it. Both are kept identical on every row of a salary payment group.

Existing rows are filled here: "Salary for {Month}" (+ " · {reference}"), "Advance for {Month}",
and for a group of several months "Bulk salary payment · {Month} Rs X (cleared) · ...". Every
month of an old group but the last was cleared by it (the split goes oldest first and only moves
on once a month is fully paid); whether the last one was cleared was not recorded, so its part
carries no status. Existing notes count as written by the recorder at creation.

Revision ID: payroll_0004
Revises: payroll_0003
Create Date: 2026-10-26 10:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "payroll_0004"
down_revision = "payroll_0003"
branch_labels = None
depends_on = None

SCHEMA = "payroll"

NAMES = (
    "ARRAY['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin',"
    "'Kartik','Mangsir','Poush','Magh','Falgun','Chaitra']"
)


def upgrade() -> None:
    op.add_column("payments", sa.Column("system_remark", sa.Text(), nullable=True), schema=SCHEMA)
    op.alter_column(
        "payments", "note", type_=sa.Text(), existing_type=sa.String(200), schema=SCHEMA
    )
    op.add_column(
        "payments",
        sa.Column("note_updated_by", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_payments_note_updated_by_users",
        "payments",
        "users",
        ["note_updated_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.add_column(
        "payments",
        sa.Column("note_updated_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )

    op.execute(
        f"""
        UPDATE {SCHEMA}.payments
        SET system_remark = CASE kind
            WHEN 'advance' THEN 'Advance for ' || ({NAMES})[for_month]
            ELSE 'Salary for ' || ({NAMES})[for_month]
                 || COALESCE(' · ' || NULLIF(reference, ''), '')
        END
        """
    )
    op.execute(
        f"""
        WITH parts AS (
            SELECT payment_group_id, for_year, for_month, id,
                   ({NAMES})[for_month] || ' Rs ' || to_char(amount, 'FM999,999,999,990')
                   || CASE WHEN row_number() OVER w_desc = 1 THEN '' ELSE ' (cleared)' END AS part,
                   count(*) OVER (PARTITION BY payment_group_id) AS n
            FROM {SCHEMA}.payments
            WHERE payment_group_id IS NOT NULL
            WINDOW w_desc AS (
                PARTITION BY payment_group_id ORDER BY for_year DESC, for_month DESC, id DESC
            )
        ), groups AS (
            SELECT payment_group_id,
                   'Bulk salary payment · '
                   || string_agg(part, ' · ' ORDER BY for_year, for_month, id) AS remark
            FROM parts
            WHERE n > 1
            GROUP BY payment_group_id
        )
        UPDATE {SCHEMA}.payments p
        SET system_remark = g.remark
        FROM groups g
        WHERE p.payment_group_id = g.payment_group_id
        """
    )
    op.execute(f"UPDATE {SCHEMA}.payments SET note = NULLIF(btrim(note), '')")
    op.execute(
        f"""
        UPDATE {SCHEMA}.payments
        SET note_updated_by = recorded_by, note_updated_at = created_at
        WHERE note IS NOT NULL
        """
    )
    op.alter_column("payments", "system_remark", nullable=False, schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("payments", "note_updated_at", schema=SCHEMA)
    op.drop_constraint(
        "fk_payments_note_updated_by_users", "payments", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("payments", "note_updated_by", schema=SCHEMA)
    op.execute(f"UPDATE {SCHEMA}.payments SET note = left(note, 200)")
    op.alter_column(
        "payments", "note", type_=sa.String(200), existing_type=sa.Text(), schema=SCHEMA
    )
    op.drop_column("payments", "system_remark", schema=SCHEMA)
