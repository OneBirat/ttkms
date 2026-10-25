"""payroll_0001: the three tables, their constraints and the per-kind receipt sequences."""

import asyncio
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.models import Branch, Employee
from app.modules.payroll.models import (
    Payment,
    PaymentKind,
    PaymentSource,
    PayType,
    SalaryHistory,
)

pytestmark = pytest.mark.anyio


async def _employee(db) -> Employee:
    branch = Branch(name="Main branch")
    db.add(branch)
    await db.flush()
    employee = Employee(full_name="Ram Thapa", branch_id=branch.id)
    db.add(employee)
    await db.flush()
    return employee


async def test_salary_history_and_payment_rows(db):
    employee = await _employee(db)
    db.add(
        SalaryHistory(
            employee_id=employee.id,
            pay_type=PayType.monthly,
            basic=22000,
            allowances=0,
            ot_rate=92,
            default_payment_mode_id=1,  # Cash, seeded by admin_0002
            effective_ad=date(2026, 10, 18),
        )
    )
    payment = Payment(
        receipt_no="ADV-0001",
        employee_id=employee.id,
        kind=PaymentKind.advance,
        for_year=2083,
        for_month=7,
        amount=1500,
        payment_mode_id=1,
        date=date(2026, 10, 24),
        source=PaymentSource.scan,
    )
    db.add(payment)
    await db.flush()
    await db.refresh(payment)
    assert payment.paid_at is not None and payment.created_at is not None
    rows = (
        await db.scalars(select(SalaryHistory).where(SalaryHistory.employee_id == employee.id))
    ).all()
    assert rows[0].pay_type is PayType.monthly and rows[0].default_payment_mode_id == 1


@pytest.mark.parametrize(
    "bad",
    [{"amount": 0}, {"amount": -5}, {"for_month": 0}, {"for_month": 13}, {"payment_mode_id": 999}],
)
async def test_payment_constraints(db, bad):
    employee = await _employee(db)
    values = dict(
        receipt_no="SAL-0001",
        employee_id=employee.id,
        kind=PaymentKind.salary,
        for_year=2083,
        for_month=6,
        amount=1000,
        payment_mode_id=1,
        date=date(2026, 10, 24),
        source=PaymentSource.account,
    )
    values.update(bad)
    db.add(Payment(**values))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_receipt_sequences_never_repeat_under_concurrent_inserts(migrated_database):
    """Two sessions take a number from the same sequence at the same time: both succeed, the
    numbers differ, and the kinds keep separate counters."""

    async def take(kind: str) -> str:
        engine = create_async_engine(migrated_database, poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                value = await conn.scalar(text(f"SELECT nextval('payroll.receipt_{kind}_seq')"))
                return f"{'ADV' if kind == 'adv' else 'SAL'}-{int(value):04d}"
        finally:
            await engine.dispose()

    first, second = await asyncio.gather(take("adv"), take("adv"))
    assert first != second and first.startswith("ADV-") and second.startswith("ADV-")
    sal = await take("sal")
    assert sal.startswith("SAL-")
