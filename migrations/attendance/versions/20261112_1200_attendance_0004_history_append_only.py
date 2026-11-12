"""attendance: record_changes is append-only, and keeps the name of who made the change

``record_changes`` is the history of every create, change and removal of a mark: who, when,
old value, new value, reason, override yes/no. From here on its rows cannot be edited or
deleted - by anyone, the application included:

* a row trigger refuses every UPDATE and DELETE, a statement trigger refuses TRUNCATE;
* the one UPDATE let through is the foreign key's own ``ON DELETE SET NULL`` on ``changed_by``
  (a user row removed from the database), and only when nothing else changes - so
  ``changed_by_name`` (new: the person's name when they made the change) keeps saying who.

Revision ID: attendance_0004
Revises: attendance_0003
Create Date: 2026-11-12 12:00

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "attendance_0004"
down_revision = "attendance_0003"
branch_labels = None
depends_on = None

SCHEMA = "attendance"

FUNCTION = """
CREATE FUNCTION attendance.record_changes_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.changed_by IS NULL AND OLD.changed_by IS NOT NULL
           AND (to_jsonb(NEW) - 'changed_by') = (to_jsonb(OLD) - 'changed_by') THEN
            RETURN NEW;  -- the user row is gone (ON DELETE SET NULL); changed_by_name stays
        END IF;
    END IF;
    RAISE EXCEPTION 'attendance history is append-only: % refused on record_changes', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$
"""


def upgrade() -> None:
    op.add_column(
        "record_changes",
        sa.Column(
            "changed_by_name", sa.String(length=120), server_default=sa.text("''"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.execute(
        """
        UPDATE attendance.record_changes c
        SET changed_by_name = u.full_name
        FROM core.users u
        WHERE u.id = c.changed_by
        """
    )
    op.execute(FUNCTION)
    op.execute(
        """
        CREATE TRIGGER record_changes_no_update_delete
        BEFORE UPDATE OR DELETE ON attendance.record_changes
        FOR EACH ROW EXECUTE FUNCTION attendance.record_changes_append_only()
        """
    )
    op.execute(
        """
        CREATE TRIGGER record_changes_no_truncate
        BEFORE TRUNCATE ON attendance.record_changes
        FOR EACH STATEMENT EXECUTE FUNCTION attendance.record_changes_append_only()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER record_changes_no_truncate ON attendance.record_changes")
    op.execute("DROP TRIGGER record_changes_no_update_delete ON attendance.record_changes")
    op.execute("DROP FUNCTION attendance.record_changes_append_only()")
    op.drop_column("record_changes", "changed_by_name", schema=SCHEMA)
