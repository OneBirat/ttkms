"""Cross-module contracts.

Modules talk to each other only through these interfaces - never by importing another module's
internals. Payroll asks attendance for a month summary through :func:`get_attendance_summary`;
until the attendance module calls :func:`register_attendance_summary` with its implementation,
the deterministic :class:`FakeAttendanceSummary` is returned so payroll can be built and tested
on its own. The other way round, attendance's scan flow pays salary / advances and its report
badges list the month's payments through :func:`get_payroll_payments` (:class:`PayrollPayments`),
with :class:`FakePayrollPayments` standing in until payroll registers its service.

Attendance rules (decided 24 Oct 2026, ``app/modules/attendance/API_NOTES.md``): a day is only
``P`` present, ``O`` overtime (present + whole hours 1-12) or ``A`` absent; weekly off (Saturday)
without a record is paid; "not marked" means no record. Paid days = present + overtime days +
weekly off. Overtime hours are paid hourly by payroll.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable


@dataclass
class MonthSummary:
    """One employee's attendance for one BS month, the way payroll needs it."""

    days_in_month: int
    #: Days marked P.
    present: int
    #: Days marked O (present with overtime).
    overtime_days: int
    #: Sum of the overtime hours of those days.
    overtime_hours: int
    #: Days marked A (unpaid).
    absent: int
    #: Weekly-off days without a record (paid).
    weekly_off: int
    #: present + overtime_days + weekly_off.
    paid_days: int


@runtime_checkable
class AttendanceSummary(Protocol):
    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary: ...


def _days_in_month(bs_year: int, bs_month: int) -> int:
    from app.core import bsdate

    return bsdate.days_in_month(bs_year, bs_month)


class FakeAttendanceSummary:
    """Deterministic sample data: the same inputs always give the same summary, and the days
    add up (present + overtime_days + absent + weekly_off + not marked = days_in_month)."""

    async def for_month(self, employee_id: int, bs_year: int, bs_month: int) -> MonthSummary:
        days = _days_in_month(bs_year, bs_month)
        seed = (employee_id * 31 + bs_year * 12 + bs_month) % 7
        weekly_off = sum(1 for d in range(days) if (d + seed) % 7 == 0)
        working = days - weekly_off
        absent = (seed + 1) % 2
        not_marked = seed % 3
        overtime_days = (seed + employee_id) % 4
        overtime_hours = overtime_days * (2 + seed % 3)
        present = working - absent - not_marked - overtime_days
        return MonthSummary(
            days_in_month=days,
            present=present,
            overtime_days=overtime_days,
            overtime_hours=overtime_hours,
            absent=absent,
            weekly_off=weekly_off,
            paid_days=present + overtime_days + weekly_off,
        )


_fake = FakeAttendanceSummary()
_registered: AttendanceSummary | None = None


def register_attendance_summary(implementation: AttendanceSummary) -> None:
    """Called by the attendance module (e.g. at import time) to replace the fake."""
    global _registered
    _registered = implementation


def reset_attendance_summary() -> None:
    global _registered
    _registered = None


def get_attendance_summary() -> AttendanceSummary:
    return _registered if _registered is not None else _fake


# ---------------------------------------------------------------------- payroll -> attendance

PaymentKind = Literal["salary", "advance"]
PaymentSource = Literal["scan", "account"]

#: ``admin.payment_modes`` row 1 is the built-in Cash mode (always active).
CASH_PAYMENT_MODE_ID = 1


@dataclass
class MonthBalance:
    """One employee's pay position for one BS month, as the scan pop-up shows it."""

    employee_id: int
    bs_year: int
    bs_month: int
    #: "2083-07"
    month_key: str
    #: "Kartik 2083"
    month_label: str
    #: Net earned so far this month (salary after absence, plus overtime), rupees.
    earned: int
    #: Salary and advances already paid against the month.
    paid: int
    #: max(0, earned - paid).
    due: int


@dataclass
class PaymentInput:
    """A salary or advance payment to record. The payment belongs to the BS month of its date;
    ``date`` (AD) or ``date_bs`` may be given, both default to today in Kathmandu."""

    employee_id: int
    kind: PaymentKind
    #: Whole rupees, > 0 and never above the month's ``due``.
    amount: int
    payment_mode_id: int = CASH_PAYMENT_MODE_ID
    date: dt.date | None = None
    date_bs: str | None = None
    note: str = ""
    #: Where it was recorded: the attendance scan flow or payroll's account screen.
    source: PaymentSource = "scan"


@dataclass
class PaymentRecord:
    """One recorded payment, the way the attendance report and history sheet list it."""

    payment_id: int
    #: "ADV-0412" / "SAL-0410" (payroll's receipt numbering).
    receipt_no: str
    employee_id: int
    bs_year: int
    bs_month: int
    kind: PaymentKind
    amount: int
    payment_mode_id: int
    #: Display name of the mode ("Cash").
    payment_mode: str
    date: dt.date
    date_bs: str
    note: str
    source: PaymentSource
    recorded_at: dt.datetime


@dataclass
class PaymentResult:
    payment: PaymentRecord
    #: The month's balance due after this payment.
    due_after: int


class PaymentRejected(ValueError):
    """A payment the rules refuse; the API answers 422 with ``code`` and the message."""

    def __init__(
        self, code: Literal["amount", "over_due", "unknown_employee", "payment_mode"], message: str
    ):
        super().__init__(message)
        self.code = code


@runtime_checkable
class PayrollPayments(Protocol):
    async def balance(self, employee_id: int, bs_year: int, bs_month: int) -> MonthBalance: ...

    async def record(
        self, payment: PaymentInput, recorded_by: int | None = None
    ) -> PaymentResult: ...

    async def for_month(
        self, bs_year: int, bs_month: int, employee_ids: Iterable[int] | None = None
    ) -> dict[int, list[PaymentRecord]]:
        """Payments of the month per employee (oldest first), for the report badges. ``None``
        means every employee; employees without payments are left out of the dict."""
        ...


def resolve_payment_date(payment: PaymentInput) -> tuple[dt.date, str]:
    """``(ad, bs)`` for a payment: from ``date_bs``, else ``date``, else today in Kathmandu."""
    from app.core import bsdate

    if payment.date_bs:
        bs = bsdate.parse_bs(payment.date_bs)
        return bs.to_ad(), bs.isoformat()
    ad = payment.date or bsdate.today_ad()
    return ad, bsdate.ad_to_bs(ad).isoformat()


def month_key(bs_year: int, bs_month: int) -> str:
    return f"{bs_year:04d}-{bs_month:02d}"


def month_label(bs_year: int, bs_month: int) -> str:
    from app.core import bsdate

    return f"{bsdate.bs_month_name(bs_month)} {bs_year}"


#: The design's sample history behind the fake's base amounts (day of month, kind, amount, note).
_FAKE_HISTORY: dict[int, tuple[tuple[int, PaymentKind, int, str], ...]] = {
    5000: ((4, "advance", 2000, "Cash"), (11, "advance", 3000, "Cash")),
    8000: (
        (3, "advance", 2000, "Cash"),
        (9, "advance", 1500, "Cash"),
        (15, "salary", 4500, "Part salary"),
    ),
}


class FakePayrollPayments:
    """Deterministic sample data mirroring ``web/components/attendance/mock/store.ts``: a third
    of the employees have paid nothing, a third 5,000, a third 8,000; payments recorded through
    :meth:`record` are kept in memory (:meth:`reset` forgets them). Employees are not checked
    against the database - the fake knows no employees."""

    def __init__(self) -> None:
        self._recorded: dict[tuple[int, int, int], list[PaymentRecord]] = {}
        self._next_id = 1000

    def reset(self) -> None:
        self._recorded.clear()
        self._next_id = 1000

    @staticmethod
    def earned_of(employee_id: int) -> int:
        return 18000 + ((employee_id - 1) * 731) % 9000

    @staticmethod
    def _base_paid(employee_id: int, earned: int) -> int:
        return min((0, 5000, 8000)[(employee_id - 1) % 3], earned)

    def _seeded(self, employee_id: int, bs_year: int, bs_month: int) -> list[PaymentRecord]:
        from app.core import bsdate

        earned = self.earned_of(employee_id)
        rows = _FAKE_HISTORY.get(self._base_paid(employee_id, earned), ())
        out: list[PaymentRecord] = []
        for index, (day, kind, amount, note) in enumerate(rows):
            bs = bsdate.BSDate(bs_year, bs_month, min(day, bsdate.days_in_month(bs_year, bs_month)))
            ad = bs.to_ad()
            payment_id = employee_id * 100 + index + 1
            out.append(
                PaymentRecord(
                    payment_id=payment_id,
                    receipt_no=_receipt_no(kind, payment_id),
                    employee_id=employee_id,
                    bs_year=bs_year,
                    bs_month=bs_month,
                    kind=kind,
                    amount=amount,
                    payment_mode_id=CASH_PAYMENT_MODE_ID,
                    payment_mode="Cash",
                    date=ad,
                    date_bs=bs.isoformat(),
                    note=note,
                    source="account",
                    recorded_at=dt.datetime.combine(ad, dt.time(10, 0), tzinfo=_KATHMANDU),
                )
            )
        return out

    def _payments(self, employee_id: int, bs_year: int, bs_month: int) -> list[PaymentRecord]:
        return self._seeded(employee_id, bs_year, bs_month) + self._recorded.get(
            (employee_id, bs_year, bs_month), []
        )

    async def balance(self, employee_id: int, bs_year: int, bs_month: int) -> MonthBalance:
        earned = self.earned_of(employee_id)
        paid = sum(p.amount for p in self._payments(employee_id, bs_year, bs_month))
        return MonthBalance(
            employee_id=employee_id,
            bs_year=bs_year,
            bs_month=bs_month,
            month_key=month_key(bs_year, bs_month),
            month_label=month_label(bs_year, bs_month),
            earned=earned,
            paid=paid,
            due=max(0, earned - paid),
        )

    async def record(self, payment: PaymentInput, recorded_by: int | None = None) -> PaymentResult:
        if not isinstance(payment.amount, int) or payment.amount <= 0:
            raise PaymentRejected("amount", "Enter an amount above 0.")
        ad, bs_iso = resolve_payment_date(payment)
        bs_year, bs_month = int(bs_iso[:4]), int(bs_iso[5:7])
        before = await self.balance(payment.employee_id, bs_year, bs_month)
        if payment.amount > before.due:
            raise PaymentRejected(
                "over_due", f"More than the balance due for {before.month_label}."
            )
        self._next_id += 1
        record = PaymentRecord(
            payment_id=self._next_id,
            receipt_no=_receipt_no(payment.kind, self._next_id),
            employee_id=payment.employee_id,
            bs_year=bs_year,
            bs_month=bs_month,
            kind=payment.kind,
            amount=payment.amount,
            payment_mode_id=payment.payment_mode_id,
            payment_mode="Cash"
            if payment.payment_mode_id == CASH_PAYMENT_MODE_ID
            else f"Mode {payment.payment_mode_id}",
            date=ad,
            date_bs=bs_iso,
            note=payment.note,
            source=payment.source,
            recorded_at=dt.datetime.now(dt.UTC),
        )
        self._recorded.setdefault((payment.employee_id, bs_year, bs_month), []).append(record)
        return PaymentResult(payment=record, due_after=before.due - payment.amount)

    async def for_month(
        self, bs_year: int, bs_month: int, employee_ids: Iterable[int] | None = None
    ) -> dict[int, list[PaymentRecord]]:
        if employee_ids is None:
            # The fake knows no employee list: it can only answer for those asked about or paid.
            employee_ids = sorted(
                {key[0] for key in self._recorded if key[1:] == (bs_year, bs_month)}
            )
        out: dict[int, list[PaymentRecord]] = {}
        for employee_id in employee_ids:
            payments = self._payments(employee_id, bs_year, bs_month)
            if payments:
                out[employee_id] = sorted(payments, key=lambda p: (p.date, p.payment_id))
        return out


_KATHMANDU = dt.timezone(dt.timedelta(hours=5, minutes=45))


def _receipt_no(kind: PaymentKind, payment_id: int) -> str:
    return f"{'ADV' if kind == 'advance' else 'SAL'}-{payment_id:04d}"


_fake_payroll = FakePayrollPayments()
_registered_payroll: PayrollPayments | None = None


def register_payroll_payments(implementation: PayrollPayments) -> None:
    """Called by the payroll module (e.g. at import time) to replace the fake."""
    global _registered_payroll
    _registered_payroll = implementation


def reset_payroll_payments() -> None:
    global _registered_payroll
    _registered_payroll = None
    _fake_payroll.reset()


def get_payroll_payments() -> PayrollPayments:
    return _registered_payroll if _registered_payroll is not None else _fake_payroll
