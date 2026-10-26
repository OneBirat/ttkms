"""System remarks on payments: written once by the server when a payment is created, never
accepted from a client and never edited. The human note next to it is separate (PATCH .../note).

- single salary: "Salary for Kartik" (+ " · {reference}" for bank / wallet payments)
- advance:       "Advance for Kartik"
- bulk salary:   "Bulk salary payment · Ashwin Rs 30,000 (cleared)
                  · Kartik Rs 8,230 (part, Rs 3,000 left)"
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.core import bsdate


def single_remark(kind: str, for_month: int, reference: str | None = None) -> str:
    name = bsdate.bs_month_name(for_month)
    if kind == "advance":
        return f"Advance for {name}"
    return f"Salary for {name}" + (f" · {reference}" if reference else "")


@dataclass(frozen=True)
class BulkPart:
    for_month: int
    amount: int
    #: What the month still owed after this part; None when unknown (rows filled by payroll_0004).
    left: int | None


def bulk_remark(parts: Sequence[BulkPart]) -> str:
    def one(p: BulkPart) -> str:
        text = f"{bsdate.bs_month_name(p.for_month)} Rs {p.amount:,}"
        if p.left is None:
            return text
        return f"{text} (cleared)" if p.left <= 0 else f"{text} (part, Rs {p.left:,} left)"

    return " · ".join(["Bulk salary payment", *(one(p) for p in parts)])


def remark_default(context) -> str:
    """Column default: any insert that does not set a remark gets the single-payment one (a
    bulk salary payment overwrites it in the same transaction)."""
    params = context.get_current_parameters()
    kind = params.get("kind")
    kind = getattr(kind, "value", kind) or "salary"
    month = params.get("for_month")
    if not isinstance(month, int) or not 1 <= month <= 12:
        return ""  # the for_month CHECK constraint rejects the row
    return single_remark(kind, month, params.get("reference"))
