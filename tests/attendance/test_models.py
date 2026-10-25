"""attendance.records constraints: one mark per employee per day, P / O / A only, overtime
hours > 0 exactly with O (1-12)."""

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.modules.attendance.models import Record

pytestmark = pytest.mark.anyio

DAY = date(2026, 10, 20)


def _record(employee, status="P", hours=0, day=DAY):
    return Record(
        employee_id=employee.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=employee.branch_id,
        source="manual",
    )


async def _fails(db, record):
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            db.add(record)
            await db.flush()


async def test_one_record_per_employee_per_day(db, world):
    anita = world.people["Anita"]
    db.add(_record(anita))
    await db.flush()
    await _fails(db, _record(anita, "A"))
    db.add(_record(anita, day=date(2026, 10, 21)))
    db.add(_record(world.people["Bikash"]))
    await db.flush()


@pytest.mark.parametrize(
    ("status", "hours"), [("O", 0), ("P", 2), ("A", 1), ("O", 13), ("O", -1), ("W", 0), ("N", 0)]
)
async def test_status_and_hours_must_agree(db, world, status, hours):
    await _fails(db, _record(world.people["Anita"], status, hours))


@pytest.mark.parametrize(("status", "hours"), [("P", 0), ("A", 0), ("O", 1), ("O", 12)])
async def test_valid_marks(db, world, status, hours):
    db.add(_record(world.people["Anita"], status, hours))
    await db.flush()


async def test_source_is_checked(db, world):
    record = _record(world.people["Anita"])
    record.source = "phone"
    await _fails(db, record)
