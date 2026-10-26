"""Who may do what in attendance, and which branch they see.

* ``mark_attendance`` - day list, mark / change / clear, bulk mark, scan, employee month.
* ``view_attendance_report`` - the month report and its exports (also the employee month).
* ``see_other_branches`` - switch the user's ONE active branch (``core.users.active_branch_id``);
  without it every call is scoped to the user's own branch (``admin.user_access.branch_id``)
  whatever the query string says, and a user without a branch sees nobody. No call answers
  for every branch at once.

Permissions come from :mod:`app.modules.admin.permissions` (role preset + per-user overrides).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import User
from app.modules.admin.permissions import access_for_user, branch_scope, require_access

MARK = "mark_attendance"
REPORT = "view_attendance_report"
# Payroll's permission: the employee account shows the employee month (Attendance card).
EMPLOYEES = "manage_employees"
OTHER_BRANCHES = "see_other_branches"
#: Payroll's switch: without it attendance answers carry no payment amounts, badges or flags.
MONEY = "salary_advances"


@dataclass(frozen=True)
class Scope:
    #: The ONE branch to show: the user's active branch, or an explicit one with
    #: ``see_other_branches`` (0 = nothing for a user without a branch). Never every branch.
    branch_id: int
    any_branch: bool

    def allows(self, branch_id: int) -> bool:
        return self.branch_id == branch_id


async def sees_money(db: AsyncSession, user: User) -> bool:
    """Payment amounts in attendance (report badges, employee month, day-list flags) are for
    users with ``salary_advances`` only - left out server-side for everyone else."""
    return bool((await access_for_user(db, user)).get(MONEY))


async def scope_for(db: AsyncSession, user: User, requested: int | None) -> Scope:
    scope = await branch_scope(db, user, requested)
    return Scope(scope.branch_id, scope.can_switch)


def other_branch(employee) -> HTTPException:
    """403 for an employee outside the active branch, naming where they are."""
    where = employee.branch.name if employee.branch else "another branch"
    return HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail=f"{employee.full_name} is in {where}. Switch to that branch to open them.",
    )


async def one_branch(db: AsyncSession, scope: Scope) -> int:
    """The single branch a screen works on (kept for the call sites; always the scope's)."""
    return scope.branch_id


CanMark = Annotated[User, Depends(require_access(MARK))]
CanReport = Annotated[User, Depends(require_access(REPORT))]
