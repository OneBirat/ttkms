"""`seed-demo`: 25 staff across both branches with salaries and payments; dev only; idempotent."""

import pytest
from sqlalchemy import func, select

from app.config import settings
from app.core.models import Branch, Employee
from app.modules.payroll.models import Payment, SalaryHistory
from app.modules.payroll.seed_demo import ROWS, NotDevelopment, seed_demo

pytestmark = pytest.mark.anyio


async def test_seed_demo_loads_staff_salaries_and_payments(db, make_user):
    await make_user("admin")
    created = await seed_demo(db)
    assert created["employees"] == len(ROWS) == 25 and created["skipped"] == 0
    assert created["salary_rows"] >= 25 and created["payments"] > 0
    per_branch = dict(
        (
            await db.execute(
                select(Branch.name, func.count())
                .join(Employee, Employee.branch_id == Branch.id)
                .group_by(Branch.name)
            )
        ).all()
    )
    assert set(per_branch) == {"Main branch", "Branch 2"} and all(
        n > 0 for n in per_branch.values()
    )
    employees = (await db.scalars(select(Employee))).all()
    assert all(e.joined_ad and e.address and e.phone for e in employees)
    assert {s.pay_type.value for s in await db.scalars(select(SalaryHistory))} == {
        "monthly",
        "daily",
    }
    paid = (await db.scalars(select(Payment))).all()
    kinds = {p.kind.value for p in paid}
    assert "salary" in kinds and "advance" in kinds
    assert len({p.receipt_no for p in paid}) == len(paid)
    branches_paid = {
        b
        for (b,) in (
            await db.execute(
                select(Employee.branch_id)
                .join(Payment, Payment.employee_id == Employee.id)
                .distinct()
            )
        ).all()
    }
    assert len(branches_paid) == 2
    # Running it again changes nothing.
    again = await seed_demo(db)
    assert again["employees"] == 0 and again["payments"] == 0 and again["skipped"] == 25


async def test_seed_demo_refuses_outside_development(db, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "prod")
    with pytest.raises(NotDevelopment):
        await seed_demo(db)
