"""What a super-admin change to a past day would do to pay - asked before the change is saved.

Salary and dues are never stored: payroll recalculates them from attendance every time
(``PayrollPayments`` / ``AttendanceSummary``), so an override changes the month's net pay and due
by itself. When that month already has salary paid (fully or partly), the confirm sheet warns:
"Ashwin 2083 salary is already paid. This changes the net pay by Rs -1,000; the due will become
Rs 4,000." It warns; it never blocks.
"""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.contracts import get_payroll_payments
from app.core import bsdate
from app.core.models import Employee, User
from app.core.modules import is_enabled
from app.modules.attendance import schemas, services
from app.modules.attendance.access import Scope
from app.modules.attendance.contract import month_if

SUPER_ADMIN_ONLY = "Only the super admin can change past attendance."


def rs(amount: int) -> str:
    """ "Rs 4,000" """
    return f"Rs {amount:,}"


def signed_rs(amount: int) -> str:
    """ "Rs -1,000" / "Rs +1,000" """
    return f"Rs {amount:+,}"


def warning_text(month_label: str, net_change: int, due_after: int, overpaid: int) -> str:
    text = (
        f"{month_label} salary is already paid. This changes the net pay by "
        f"{signed_rs(net_change)}; the due will become {rs(due_after)}."
    )
    if overpaid:
        text += f" {rs(overpaid)} is already paid above the new net pay."
    return text


async def payroll_impact(
    db: AsyncSession, employee: Employee, ad: date, status_: str | None, hours: int
) -> tuple[schemas.PayrollImpact | None, str, int]:
    """(the impact or None, the day's present status, its hours)."""
    before_summary, after_summary, current = await month_if(db, employee, ad, status_, hours)
    old_status = current.status if current else "N"
    old_hours = current.overtime_hours if current else 0
    if not is_enabled("payroll"):
        return None, old_status, old_hours
    bs = bsdate.ad_to_bs(ad)
    payroll = get_payroll_payments()
    before = await payroll.what_if(employee.id, bs.year, bs.month, before_summary)
    after = await payroll.what_if(employee.id, bs.year, bs.month, after_summary)
    if before is None or after is None:
        return None, old_status, old_hours
    net_change = after.earned - before.earned
    overpaid = max(0, after.paid - after.earned)
    warn = after.paid > 0 and net_change != 0
    return (
        schemas.PayrollImpact(
            month_label=after.month_label,
            for_year=bs.year,
            for_month=bs.month,
            paid=after.paid,
            net_before=before.earned,
            net_after=after.earned,
            net_change=net_change,
            due_before=before.due,
            due_after=after.due,
            overpaid=overpaid,
            warning=(
                warning_text(after.month_label, net_change, after.due, overpaid) if warn else None
            ),
        ),
        old_status,
        old_hours,
    )


async def override_preview(
    db: AsyncSession, user: User, scope: Scope, body: schemas.OverridePreviewRequest
) -> schemas.OverridePreview:
    if not user.is_super_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=SUPER_ADMIN_ONLY)
    ad = services.parse_day(body.date_bs)
    services.check_no_future_write(ad)
    items: list[schemas.OverridePreviewItem] = []
    for change in body.changes:
        employee = await services.employee_to_mark(db, scope, change.employee_id)
        hours = change.ot_hours if change.status == "O" else 0
        if change.status is not None:
            services.check_mark(employee, ad, change.status, hours)
        impact, old_status, old_hours = await payroll_impact(db, employee, ad, change.status, hours)
        items.append(
            schemas.OverridePreviewItem(
                employee_id=employee.id,
                name=employee.full_name,
                old_status=old_status,
                old_hours=old_hours,
                new_status=change.status or "N",
                new_hours=hours,
                payroll=impact,
            )
        )
    warnings = [
        f"{item.name}: {item.payroll.warning}" if len(items) > 1 else item.payroll.warning
        for item in items
        if item.payroll and item.payroll.warning
    ]
    return schemas.OverridePreview(
        date=ad,
        date_bs=services.bs_of(ad),
        items=items,
        warning="\n".join(warnings) or None,
    )
