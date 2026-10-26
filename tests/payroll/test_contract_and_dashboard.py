"""The real PayrollPayments contract and the branch-scoped "Payments today" figures."""

from datetime import date

import pytest
from sqlalchemy import select

from app import contracts
from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.payroll import contract
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource, PayType, SalaryHistory

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)
PREVIOUS = bsdate.shift_month(*CURRENT, -1)


async def _setup(db):
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store = Department(name="Store")
    db.add_all([main, second, store])
    await db.flush()
    people = {}
    # One day's pay (Kartik 1: salary / 30) still covers the advances below.
    for name, branch, amount in [("Anita", main, 220000), ("Mina", second, 240000)]:
        e = Employee(
            full_name=name, branch_id=branch.id, department_id=store.id, joined_ad=date(2026, 1, 1)
        )
        db.add(e)
        await db.flush()
        db.add(
            SalaryHistory(
                employee_id=e.id,
                pay_type=PayType.monthly,
                basic=amount,
                ot_rate=100,
                default_payment_mode_id=1,
                effective_ad=date(2026, 1, 1),
            )
        )
        people[name] = e
    await db.flush()
    return main, second, people


async def _pay(db, employee, kind, amount, month, receipt):
    db.add(
        Payment(
            receipt_no=receipt,
            employee_id=employee.id,
            branch_id=employee.branch_id,
            kind=PaymentKind(kind),
            for_year=month[0],
            for_month=month[1],
            amount=amount,
            payment_mode_id=1,
            date=bsdate.today_ad(),
            source=PaymentSource.account,
        )
    )
    await db.flush()


def test_the_module_registers_the_real_contract():
    contract.register()
    try:
        assert isinstance(contracts.get_payroll_payments(), contract.PayrollPaymentsService)
        assert isinstance(contract.PAYROLL_PAYMENTS, contracts.PayrollPayments)
    finally:
        contracts.reset_payroll_payments()


async def test_balance_record_and_for_month_through_the_contract(migrated_database, monkeypatch):
    """The contract opens its own sessions (pointed at the test database here), so the fixtures
    are committed for real through a separate engine and removed again at the end."""
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.core.models import AuditLog

    engine = create_async_engine(migrated_database, poolclass=NullPool)
    monkeypatch.setattr(
        contract, "SESSION_FACTORY", async_sessionmaker(engine, expire_on_commit=False)
    )
    async with AsyncSession(engine, expire_on_commit=False) as db:
        main, second, people = await _setup(db)
        await db.commit()
        anita, mina = people["Anita"], people["Mina"]
        ids = [anita.id, mina.id]
    service = contract.PayrollPaymentsService()
    try:
        before = await service.balance(anita.id, *CURRENT)
        assert isinstance(before, contracts.MonthBalance)
        assert before.earned > 0 and before.paid == 0 and before.due == before.earned
        assert before.month_label == f"{bsdate.bs_month_name(CURRENT[1])} {CURRENT[0]}"
        # An advance from the scan flow: no for_* -> the month of the date (today).
        result = await service.record(
            contracts.PaymentInput(employee_id=anita.id, kind="advance", amount=1500, note="Cash")
        )
        assert isinstance(result, contracts.PaymentResult)
        assert result.payment.receipt_no.startswith("ADV-") and result.payment.kind == "advance"
        assert (result.payment.for_year, result.payment.for_month) == CURRENT
        assert result.payment.payment_mode == "Cash" and result.payment.source == "scan"
        assert result.due_after == before.due - 1500
        after = await service.balance(anita.id, *CURRENT)
        assert after.paid == 1500 and after.due == before.due - 1500
        # Caps and modes are the API's.
        with pytest.raises(contracts.PaymentRejected) as over:
            await service.record(
                contracts.PaymentInput(employee_id=anita.id, kind="advance", amount=after.due + 1)
            )
        assert over.value.code == "over_due"
        with pytest.raises(contracts.PaymentRejected) as zero:
            await service.record(
                contracts.PaymentInput(employee_id=anita.id, kind="advance", amount=0)
            )
        assert zero.value.code == "amount"
        with pytest.raises(contracts.PaymentRejected) as mode:
            await service.record(
                contracts.PaymentInput(
                    employee_id=anita.id, kind="advance", amount=100, payment_mode_id=999
                )
            )
        assert mode.value.code == "payment_mode"
        with pytest.raises(contracts.PaymentRejected) as who:
            await service.record(
                contracts.PaymentInput(employee_id=999999, kind="advance", amount=100)
            )
        assert who.value.code == "unknown_employee"
        # Payroll pays last month's salary today with explicit for_*: it counts for last month.
        prev = await service.balance(anita.id, *PREVIOUS)
        salary = await service.record(
            contracts.PaymentInput(
                employee_id=anita.id,
                kind="salary",
                amount=prev.due,
                for_year=PREVIOUS[0],
                for_month=PREVIOUS[1],
                source="account",
            )
        )
        assert (
            salary.payment.for_year,
            salary.payment.for_month,
        ) == PREVIOUS and salary.due_after == 0
        assert salary.payment.date == bsdate.today_ad()
        by_month = await service.for_month(*CURRENT, ids)
        assert [p.receipt_no for p in by_month[anita.id]] == [result.payment.receipt_no]
        assert mina.id not in by_month
        prev_month = await service.for_month(*PREVIOUS)
        assert [p.receipt_no for p in prev_month[anita.id]] == [salary.payment.receipt_no]
        assert await service.for_month(*CURRENT, []) == {}
    finally:
        async with AsyncSession(engine) as db:
            await db.execute(delete(Payment).where(Payment.employee_id.in_(ids)))
            await db.execute(delete(SalaryHistory).where(SalaryHistory.employee_id.in_(ids)))
            await db.execute(delete(AuditLog).where(AuditLog.module == "payroll"))
            await db.execute(delete(Employee).where(Employee.id.in_(ids)))
            await db.execute(delete(Department).where(Department.name == "Store"))
            await db.execute(delete(Branch).where(Branch.name.in_(["Main branch", "Branch 2"])))
            await db.commit()
        await engine.dispose()


async def test_payments_today_widget_and_counts_are_branch_scoped(client, db, make_user, login):
    main, second, people = await _setup(db)
    await _pay(db, people["Anita"], "advance", 2000, CURRENT, "ADV-9001")
    await _pay(db, people["Anita"], "salary", 5000, PREVIOUS, "SAL-9001")
    await _pay(db, people["Mina"], "advance", 700, CURRENT, "ADV-9002")
    await make_user("admin")
    await login("admin")
    widget = next(
        w
        for w in (await client.get("/api/dashboard")).json()["widgets"]
        if w["module"] == "payroll"
    )
    # The admin's active branch is Main (the first created): only Main's two payments.
    data = widget["data"]
    assert (
        data["count"] == 2
        and data["total"] == 7000
        and data["salary_total"] == 5000
        and data["advance_total"] == 2000
    )
    assert [p["name"] for p in data["payments"]] == ["Anita", "Anita"]
    assert {p["kind"] for p in data["payments"]} == {"salary", "advance"}
    assert all(
        {"payment_id", "employee_id", "name", "kind", "amount", "mode", "time"} <= set(p)
        for p in data["payments"]
    )
    assert data["payments"][0]["mode"] == "Cash" and len(data["payments"][0]["time"]) == 5
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts["paid_today"] == 7000 and counts["payments_today"] == 2
    # A manager of Branch 2 only sees Mina's payment.
    await client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]},
    )
    boss = await make_user("boss", role="manager")
    db.add(UserAccess(user_id=boss.id, branch_id=second.id, access=None))
    await db.flush()
    await login("boss")
    widget = next(
        w
        for w in (await client.get("/api/dashboard")).json()["widgets"]
        if w["module"] == "payroll"
    )
    assert widget["data"]["count"] == 1 and widget["data"]["total"] == 700
    counts = (await client.get("/api/today")).json()["counts"]
    assert counts["paid_today"] == 700 and counts["payments_today"] == 1
    assert (await db.scalar(select(Payment.receipt_no).where(Payment.amount == 700))) == "ADV-9002"
