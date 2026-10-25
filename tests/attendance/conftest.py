"""Attendance fixtures: two branches, two departments, a handful of core employees (one
inactive) and users per role, with their branch in ``admin.user_access``."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import pytest

from app.core.models import Branch, Department, Employee, EmployeeStatus, Role
from app.modules.admin.models import UserAccess


@dataclass
class World:
    main: Branch
    second: Branch
    store: Department
    kitchen: Department
    people: dict[str, Employee] = field(default_factory=dict)


@pytest.fixture
async def world(db) -> World:
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store, kitchen = Department(name="Store"), Department(name="Kitchen")
    db.add_all([main, second, store, kitchen])
    await db.flush()
    w = World(main=main, second=second, store=store, kitchen=kitchen)
    for name, branch, dept, active in [
        ("Anita", main, store, True),
        ("Bikash", main, kitchen, True),
        ("Chandra", main, store, True),
        ("Old Hari", main, store, False),
        ("Mina", second, kitchen, True),
    ]:
        e = Employee(
            full_name=name,
            branch_id=branch.id,
            department_id=dept.id,
            joined_ad=date(2026, 1, 1),
            status=EmployeeStatus.active if active else EmployeeStatus.inactive,
        )
        db.add(e)
        await db.flush()
        w.people[name] = e
    return w


@pytest.fixture
def user_in(db, make_user):
    """``await user_in("boss", "manager", branch, access={...})`` - a user working in ``branch``
    with optional permission overrides."""

    async def _make(username, role="manager", branch=None, access=None):
        user = await make_user(username, role=Role(role))
        db.add(UserAccess(user_id=user.id, branch_id=branch.id if branch else None, access=access))
        await db.flush()
        return user

    return _make
