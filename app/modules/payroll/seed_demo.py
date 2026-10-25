# ruff: noqa: E501
"""``python -m app.cli seed-demo`` - the 25 sample employees of the design across both branches,
with salary settings and a month of sample payments, into the REAL tables. Development only
(``APP_ENV=dev``); never runs on its own. Idempotent: an employee whose phone already belongs to
an active employee is skipped, and payments are only seeded for employees created in this run.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import bsdate
from app.core.models import (
    Branch,
    Department,
    Employee,
    EmployeeStatus,
    Role,
    User,
    normalize_phone,
)
from app.core.services import find_branch, find_department
from app.modules.admin.models import PaymentMode
from app.modules.payroll import ledgers, payments, rules
from app.modules.payroll.models import Payment, PayType, SalaryHistory
from app.modules.payroll.schemas import PaymentIn

BRANCHES = ["Main branch", "Branch 2"]
DEPARTMENTS = ["Store", "Kitchen", "Housekeeping", "Front desk", "Accounts"]


@dataclass(frozen=True)
class Row:
    name: str
    designation: str
    department: int  # 1-based index into DEPARTMENTS
    branch: int  # 1-based index into BRANCHES
    pay_type: str
    amount: int
    paid_by: str
    phone: str
    address: str
    joined_bs: str
    phone_alt: str | None = None
    previous: int | None = None


#: The design's 25 staff (web/app/people/_lib/mockData.ts), codes in this order.
ROWS: tuple[Row, ...] = (
    Row("Anita Gurung", "Store keeper", 1, 1, "monthly", 22000, "bank", "9841 203 311", "Balaju, Kathmandu", "2078-02-15", "9803 112 540", 20000),
    Row("Ramesh K.C.", "Store helper", 1, 1, "daily", 650, "cash", "9808 554 120", "Gongabu, Kathmandu", "2080-04-01"),
    Row("Sunita Tamang", "Store helper", 1, 1, "daily", 650, "cash", "9818 220 087", "Tokha, Kathmandu", "2081-01-10"),
    Row("Bikash Shrestha", "Senior cook", 2, 1, "monthly", 32000, "bank", "9851 044 901", "Kirtipur, Kathmandu", "2077-09-01", "9841 882 013", 30000),
    Row("Mina Rai", "Cook", 2, 1, "monthly", 24000, "bank", "9860 118 334", "Imadol, Lalitpur", "2079-06-20"),
    Row("Dipak Lama", "Kitchen helper", 2, 1, "daily", 700, "cash", "9823 405 661", "Boudha, Kathmandu", "2081-08-12"),
    Row("Sabina Magar", "Kitchen helper", 2, 1, "daily", 700, "cash", "9845 770 219", "Chabahil, Kathmandu", "2082-02-03"),
    Row("Prakash Thapa", "Cook", 2, 2, "monthly", 23000, "cash", "9812 931 450", "Suryabinayak, Bhaktapur", "2080-11-05", None, 21000),
    Row("Laxmi Karki", "Housekeeper", 3, 1, "monthly", 18000, "cash", "9867 332 108", "Kalanki, Kathmandu", "2079-03-14"),
    Row("Gita Pariyar", "Cleaner", 3, 1, "daily", 600, "cash", "9849 010 775", "Swayambhu, Kathmandu", "2081-05-22"),
    Row("Hari Bahadur Bk", "Cleaner", 3, 1, "daily", 600, "cash", "9803 660 442", "Thankot, Kathmandu", "2082-07-01"),
    Row("Kamala Adhikari", "Housekeeper", 3, 2, "monthly", 18000, "cash", "9861 557 203", "Sallaghari, Bhaktapur", "2080-01-18"),
    Row("Suresh Maharjan", "Front desk", 4, 1, "monthly", 25000, "bank", "9851 206 118", "Kupondole, Lalitpur", "2078-10-02", "9841 008 331"),
    Row("Pooja Basnet", "Front desk", 4, 1, "monthly", 24000, "bank", "9818 775 902", "Baneshwor, Kathmandu", "2081-03-09"),
    Row("Nabin Chaudhary", "Front desk", 4, 2, "monthly", 23000, "bank", "9845 330 607", "Jagati, Bhaktapur", "2082-01-25"),
    Row("Sarita Basnet", "Accountant", 5, 1, "monthly", 35000, "bank", "9841 999 120", "Sanepa, Lalitpur", "2077-04-01", "9801 234 567", 32000),
    Row("Rajan Poudel", "Accounts assistant", 5, 1, "monthly", 26000, "bank", "9860 442 319", "Koteshwor, Kathmandu", "2080-07-16"),
    Row("Binod Gurung", "Store keeper", 1, 2, "monthly", 21000, "bank", "9808 113 905", "Thimi, Bhaktapur", "2080-02-01"),
    Row("Rita Shrestha", "Store helper", 1, 2, "daily", 650, "cash", "9823 778 440", "Katunje, Bhaktapur", "2082-04-10"),
    Row("Manoj Tamang", "Cook", 2, 2, "monthly", 24000, "bank", "9818 006 273", "Lokanthali, Bhaktapur", "2079-12-01"),
    Row("Sita Lama", "Kitchen helper", 2, 2, "daily", 700, "cash", "9849 553 118", "Gatthaghar, Bhaktapur", "2081-10-20"),
    Row("Deepa Rai", "Housekeeper", 3, 2, "monthly", 18000, "cash", "9867 201 554", "Sano Thimi, Bhaktapur", "2081-06-02"),
    Row("Krishna Khadka", "Guard", 4, 1, "monthly", 19000, "cash", "9851 880 219", "Budhanilkantha, Kathmandu", "2078-08-11", "9841 557 002"),
    Row("Anjali Shahi", "Cashier", 5, 2, "monthly", 24000, "bank", "9841 330 018", "Dadhikot, Bhaktapur", "2082-09-15"),
    Row("Tek Bahadur Magar", "Guard", 4, 2, "monthly", 19000, "cash", "9808 229 667", "Nagarkot road, Bhaktapur", "2080-05-30"),
)  # fmt: skip


class NotDevelopment(RuntimeError):
    pass


def assert_dev() -> None:
    if settings.app_env != "dev":
        raise NotDevelopment("seed-demo only runs with APP_ENV=dev (this is sample data).")


async def _ref(db: AsyncSession) -> tuple[dict[int, Branch], dict[int, Department], int, int]:
    branches: dict[int, Branch] = {}
    for i, name in enumerate(BRANCHES, start=1):
        branch = await find_branch(db, name)
        if branch is None:
            branch = Branch(name=name)
            db.add(branch)
        branches[i] = branch
    departments: dict[int, Department] = {}
    for i, name in enumerate(DEPARTMENTS, start=1):
        department = await find_department(db, name)
        if department is None:
            department = Department(name=name)
            db.add(department)
        departments[i] = department
    await db.flush()
    bank = await db.scalar(
        select(PaymentMode)
        .where(PaymentMode.type == "bank", PaymentMode.active.is_(True))
        .order_by(PaymentMode.id)
    )
    if bank is None:
        bank = PaymentMode(
            type="bank",
            name="NIC Asia",
            details="A/c ··4410",
            use_salary=True,
            use_advance=False,
            active=True,
        )
        db.add(bank)
        await db.flush()
    return branches, departments, 1, bank.id


async def seed_demo(db: AsyncSession, actor: User | None = None) -> dict[str, int]:
    """Not committed - the caller owns the transaction."""
    assert_dev()
    branches, departments, cash_id, bank_id = await _ref(db)
    if actor is None:
        actor = await db.scalar(
            select(User).where(User.role == Role.admin, User.is_active.is_(True)).order_by(User.id)
        )
    created = {"employees": 0, "salary_rows": 0, "payments": 0, "skipped": 0}
    year, month = ledgers.current_month()
    previous = bsdate.shift_month(year, month, -1)
    new_employees: list[tuple[int, Employee]] = []

    for index, row in enumerate(ROWS):
        phone = normalize_phone(row.phone)
        exists = await db.scalar(
            select(Employee).where(
                Employee.phone == phone, Employee.status == EmployeeStatus.active
            )
        )
        if exists is not None:
            created["skipped"] += 1
            continue
        joined = bsdate.bs_to_ad(bsdate.parse_bs(row.joined_bs))
        employee = Employee(
            full_name=row.name,
            phone=phone,
            phone_alt=normalize_phone(row.phone_alt) if row.phone_alt else None,
            address=row.address,
            branch_id=branches[row.branch].id,
            department_id=departments[row.department].id,
            designation=row.designation,
            joined_ad=joined,
        )
        db.add(employee)
        await db.flush()
        mode_id = bank_id if row.paid_by == "bank" else cash_id
        # The design's revision: Ashadh 1 of this BS year (or the one before when not reached yet).
        revision = bsdate.bs_to_ad(bsdate.BSDate(year, 3, 1))
        if revision > bsdate.today_ad():
            revision = bsdate.bs_to_ad(bsdate.BSDate(year - 1, 3, 1))
        if row.previous is not None and revision > joined:
            db.add(
                SalaryHistory(
                    employee_id=employee.id,
                    pay_type=PayType(row.pay_type),
                    basic=row.previous,
                    allowances=0,
                    ot_rate=rules.default_ot_rate(row.pay_type, row.previous),
                    default_payment_mode_id=mode_id,
                    effective_ad=joined,
                    created_by=actor.id if actor else None,
                )
            )
            created["salary_rows"] += 1
        allowances = 2000 if row.pay_type == "monthly" and (index + 1) % 5 == 0 else 0
        db.add(
            SalaryHistory(
                employee_id=employee.id,
                pay_type=PayType(row.pay_type),
                basic=row.amount - allowances,
                allowances=allowances,
                ot_rate=rules.default_ot_rate(row.pay_type, row.amount),
                default_payment_mode_id=mode_id,
                effective_ad=revision if row.previous is not None and revision > joined else joined,
                reason="Annual increment"
                if row.previous is not None and revision > joined
                else None,
                created_by=actor.id if actor else None,
            )
        )
        created["salary_rows"] += 1
        created["employees"] += 1
        new_employees.append((index, employee))
    await db.flush()

    # A month of payments: last month's salary for most (some in part), a few advances this month.
    pay_day = bsdate.bs_to_ad(bsdate.BSDate(year, month, 3))
    if pay_day > bsdate.today_ad():
        pay_day = bsdate.today_ad()
    rule = await ledgers.saturday_rule(db)
    for index, employee in new_employees:
        await db.refresh(employee)
        structures = (await ledgers.load_structures(db, [employee.id])).get(employee.id, [])
        ledger = await ledgers.ledger_for(employee, *previous, structures, [], saturday_rule=rule)
        mode_id = structures[-1].default_payment_mode_id or cash_id
        if ledger is not None and ledger.due > 0 and index % 3 != 2:
            amount = ledger.due if index % 3 == 0 else rules.round_rs(ledger.due * 0.6)
            await payments.record_payment(
                db,
                actor,
                employee,
                PaymentIn(
                    employee_id=employee.id,
                    kind="salary",
                    for_year=previous[0],
                    for_month=previous[1],
                    amount=amount,
                    payment_mode_id=mode_id,
                    reference=f"TRX-{employee.id:04d}" if mode_id == bank_id else None,
                    date=pay_day,
                    source="account",
                ),
            )
            created["payments"] += 1
        if index % 4 == 0:
            running = await ledgers.ledger_for(
                employee,
                year,
                month,
                structures,
                (await ledgers.load_payments(db, [employee.id])).get(employee.id, []),
                saturday_rule=rule,
            )
            if running is not None and running.due >= 500:
                await payments.record_payment(
                    db,
                    actor,
                    employee,
                    PaymentIn(
                        employee_id=employee.id,
                        kind="advance",
                        for_year=year,
                        for_month=month,
                        amount=min(2000, running.due),
                        payment_mode_id=cash_id,
                        note="Festival advance",
                        source="scan" if index % 2 == 0 else "account",
                    ),
                )
                created["payments"] += 1
    return created


async def count_payments(db: AsyncSession) -> int:
    from sqlalchemy import func

    return int(await db.scalar(select(func.count()).select_from(Payment)) or 0)
