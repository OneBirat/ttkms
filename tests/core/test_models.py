import re

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.models import (
    AuditLog,
    Branch,
    Department,
    Employee,
    EmployeeStatus,
    Setting,
    normalize_name,
    normalize_username,
)
from app.core.services import (
    DEFAULT_SETTINGS,
    find_branch,
    find_department,
    get_setting,
    record_audit,
    set_setting,
)

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Main branch", "main branch"),
        ("  Main   BRANCH ", "main branch"),
        ("Front\tdesk", "front desk"),
        ("Store", "store"),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_normalize_username():
    assert normalize_username("  Admin ") == "admin"


async def test_branch_names_are_unique_ignoring_case_and_whitespace(db):
    db.add(Branch(name="Main branch"))
    await db.flush()
    branch = await find_branch(db, "  MAIN   branch ")
    assert branch is not None and branch.name == "Main branch"
    assert branch.name_norm == "main branch"

    db.add(Branch(name=" main   BRANCH"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_department_names_are_unique_ignoring_case(db):
    db.add(Department(name="Front desk"))
    await db.flush()
    assert await find_department(db, "front DESK") is not None
    db.add(Department(name="FRONT DESK"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_employee_code_is_generated_by_the_database(db):
    branch = Branch(name="Main branch")
    db.add(branch)
    await db.flush()
    first = Employee(full_name="Ram Thapa", branch=branch)
    second = Employee(full_name="Sita Sharma", branch=branch)
    db.add_all([first, second])
    await db.flush()
    assert re.fullmatch(r"E-\d{3,}", first.code)
    assert re.fullmatch(r"E-\d{3,}", second.code)
    assert int(second.code[2:]) == int(first.code[2:]) + 1
    assert first.status == EmployeeStatus.active
    assert first.created_at is not None and first.updated_at is not None


async def test_settings_store_json(db):
    for key, value in DEFAULT_SETTINGS.items():
        await set_setting(db, key, value)
    assert await get_setting(db, "weekly_off") == ["sat"]
    assert await get_setting(db, "late_after") == "09:30"
    await set_setting(db, "weekly_off", ["sat", "sun"])
    row = await db.get(Setting, "weekly_off")
    assert row is not None and row.value == ["sat", "sun"]
    assert await get_setting(db, "missing", "fallback") == "fallback"


async def test_record_audit(db):
    row = await record_audit(
        db, module="stock", action="create", entity="item", entity_id=42, data={"qty": 3}
    )
    assert row.id is not None and row.at is not None
    stored = (await db.execute(select(AuditLog))).scalar_one()
    assert stored.entity_id == "42" and stored.data == {"qty": 3} and stored.user_id is None
