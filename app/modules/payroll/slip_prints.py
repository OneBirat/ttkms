"""payroll.payslip_prints: every print of a pay slip is a row; "printed" = the latest one for
an employee and BS month."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import User
from app.modules.payroll import services
from app.modules.payroll.models import PayslipPrint


@dataclass(frozen=True)
class LastPrint:
    at: datetime
    #: How the user is named on payments too (services.user_label); "" when that user is gone.
    by: str


async def latest(
    db: AsyncSession, employee_ids: Iterable[int], year: int, month: int
) -> dict[int, LastPrint]:
    """The latest print per employee for one BS month (employees never printed are left out)."""
    ids = list(employee_ids)
    if not ids:
        return {}
    rows = await db.scalars(
        select(PayslipPrint)
        .where(
            PayslipPrint.employee_id.in_(ids),
            PayslipPrint.bs_year == year,
            PayslipPrint.bs_month == month,
        )
        .order_by(PayslipPrint.printed_at, PayslipPrint.id)
    )
    # Oldest first: the last one seen per employee wins.
    return {
        row.employee_id: LastPrint(row.printed_at, services.user_label(row.printer)) for row in rows
    }


async def record(
    db: AsyncSession, user: User, employee_ids: Iterable[int], year: int, month: int
) -> datetime:
    """One new row per employee, all with the same time."""
    now = datetime.now(UTC)
    db.add_all(
        PayslipPrint(
            employee_id=employee_id,
            bs_year=year,
            bs_month=month,
            printed_at=now,
            printed_by=user.id,
        )
        for employee_id in employee_ids
    )
    await db.flush()
    return now
