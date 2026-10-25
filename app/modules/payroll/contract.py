"""The real ``PayrollPayments`` (app/contracts.py), registered when the payroll module loads.

Attendance's scan flow and report badges call this in-process. Each call opens its own
database session; the rules are the API's (payments.py): advances against the running month
up to earned-so-far minus paid, salary up to the balance due, modes checked, for_year /
for_month explicit (the month of the payment date when the caller leaves them out).
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select

from app import contracts
from app.core import bsdate
from app.core.errors import ApiError
from app.core.models import Employee, EmployeeStatus, User
from app.db import SessionLocal
from app.modules.payroll import ledgers, payments, services
from app.modules.payroll.models import Payment
from app.modules.payroll.schemas import PaymentIn, PaymentOut

#: Where the contract's own sessions come from (the test-suite points it at its database).
SESSION_FACTORY = SessionLocal


def session():
    return SESSION_FACTORY()


def record_of(out: PaymentOut) -> contracts.PaymentRecord:
    return contracts.PaymentRecord(
        payment_id=out.id,
        receipt_no=out.receipt_no,
        employee_id=out.employee_id,
        for_year=out.for_year,
        for_month=out.for_month,
        kind=out.kind,
        amount=out.amount,
        payment_mode_id=out.payment_mode_id,
        payment_mode=out.payment_mode.name,
        date=out.date.ad,
        date_bs=out.date.bs,
        note=out.note or "",
        source=out.source,
        recorded_at=out.paid_at,
    )


#: ApiError code or field -> PaymentRejected code.
_REJECT_CODES = {
    "over_room": "over_due",
    "over_due": "over_due",
    "amount": "amount",
    "payment_mode_id": "payment_mode",
    "employee_id": "unknown_employee",
    "for_month": "over_due",
    "date_bs": "amount",
}


class PayrollPaymentsService:
    async def balance(
        self, employee_id: int, bs_year: int, bs_month: int
    ) -> contracts.MonthBalance:
        async with session() as db:
            employee = await services.get_employee(db, employee_id)
            ledger, _, _ = await payments.month_ledger_or_404(db, employee, bs_year, bs_month)
            return contracts.MonthBalance(
                employee_id=employee_id,
                bs_year=bs_year,
                bs_month=bs_month,
                month_key=contracts.month_key(bs_year, bs_month),
                month_label=contracts.month_label(bs_year, bs_month),
                earned=ledger.net,
                paid=ledger.paid,
                due=ledger.due,
            )

    async def record(
        self, payment: contracts.PaymentInput, recorded_by: int | None = None
    ) -> contracts.PaymentResult:
        ad, bs_iso = contracts.resolve_payment_date(payment)
        for_year, for_month = contracts.resolve_payment_month(payment, bs_iso)
        async with session() as db:
            employee = await db.scalar(
                select(Employee).where(
                    Employee.id == payment.employee_id, Employee.status == EmployeeStatus.active
                )
            )
            if employee is None:
                raise contracts.PaymentRejected(
                    "unknown_employee", "No active employee with that id."
                )
            actor = await db.get(User, recorded_by) if recorded_by else None
            data = PaymentIn(
                employee_id=payment.employee_id,
                kind=payment.kind,
                for_year=for_year,
                for_month=for_month,
                amount=payment.amount,
                payment_mode_id=payment.payment_mode_id,
                note=payment.note or None,
                date=ad,
                source=payment.source,
            )
            try:
                result = await payments.record_payment(db, actor, employee, data)
            except ApiError as exc:
                field = exc.extra.get("field", "")
                code = _REJECT_CODES.get(exc.code) or _REJECT_CODES.get(field, "amount")
                raise contracts.PaymentRejected(code, exc.detail) from None
            return contracts.PaymentResult(
                payment=record_of(result.payment), due_after=result.due_after
            )

    async def for_month(
        self, for_year: int, for_month: int, employee_ids: Iterable[int] | None = None
    ) -> dict[int, list[contracts.PaymentRecord]]:
        async with session() as db:
            query = (
                select(Payment)
                .where(Payment.for_year == for_year, Payment.for_month == for_month)
                .order_by(Payment.date, Payment.id)
            )
            if employee_ids is not None:
                ids = list(employee_ids)
                if not ids:
                    return {}
                query = query.where(Payment.employee_id.in_(ids))
            modes = await services.modes_by_id(db)
            out: dict[int, list[contracts.PaymentRecord]] = {}
            for p in await db.scalars(query):
                out.setdefault(p.employee_id, []).append(record_of(payments.payment_out(p, modes)))
            return out


PAYROLL_PAYMENTS = PayrollPaymentsService()


def register() -> None:
    contracts.register_payroll_payments(PAYROLL_PAYMENTS)


__all__ = ["PAYROLL_PAYMENTS", "PayrollPaymentsService", "register", "ledgers", "bsdate"]
