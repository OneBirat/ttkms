"""Who may do what in attendance, and which branch they see.

* ``mark_attendance`` - day list, mark / change / clear, bulk mark, scan, employee month.
* ``view_attendance_report`` - the month report and its exports (also the employee month).
* ``see_other_branches`` - pick any branch; without it every call is scoped to the user's own
  branch (``admin.user_access.branch_id``) whatever the query string says, and a user without a
  branch sees nobody.

Permissions come from :mod:`app.modules.admin.permissions` (role preset + per-user overrides).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Branch, User
from app.modules.admin.permissions import access_for_user, branch_for_user, require_access

MARK = "mark_attendance"
REPORT = "view_attendance_report"
# Payroll's permission: the employee account shows the employee month (Attendance card).
EMPLOYEES = "manage_employees"
OTHER_BRANCHES = "see_other_branches"
#: Payroll's switch: without it attendance answers carry no payment amounts, badges or flags.
MONEY = "salary_advances"


@dataclass(frozen=True)
class Scope:
    #: The branch to show; ``None`` = every branch (only with ``see_other_branches``).
    branch_id: int | None
    any_branch: bool

    def allows(self, branch_id: int) -> bool:
        return self.branch_id is None or self.branch_id == branch_id


async def sees_money(db: AsyncSession, user: User) -> bool:
    """Payment amounts in attendance (report badges, employee month, day-list flags) are for
    users with ``salary_advances`` only - left out server-side for everyone else."""
    return bool((await access_for_user(db, user)).get(MONEY))


async def scope_for(db: AsyncSession, user: User, requested: int | None) -> Scope:
    access = await access_for_user(db, user)
    if access.get(OTHER_BRANCHES):
        if requested is not None and await db.get(Branch, requested) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such branch.")
        return Scope(requested, True)
    own = await branch_for_user(db, user)
    # No branch assigned and no right to see others: nothing is visible (0 matches no branch).
    return Scope(own if own is not None else 0, False)


async def one_branch(db: AsyncSession, scope: Scope) -> int:
    """The single branch a screen works on: the scoped one, else the first branch."""
    if scope.branch_id is not None:
        return scope.branch_id
    first = await db.scalar(select(Branch.id).order_by(Branch.is_active.desc(), Branch.id))
    return first or 0


CanMark = Annotated[User, Depends(require_access(MARK))]
CanReport = Annotated[User, Depends(require_access(REPORT))]
