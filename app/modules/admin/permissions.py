"""Per-user access (design/final/AdminUsers.dc.html, "Access" tab).

A role is only the *starting preset*; every permission can be switched on or off per user.
Admins always keep ``manage_users`` so the system cannot be locked out.

* :data:`PERMISSIONS` / :data:`PERMISSION_GROUPS` - the six switches, in display order
* :data:`ROLE_PRESETS` - Admin = all; Manager = mark attendance, view attendance report,
  view & edit employees; Staff = mark attendance only
* :func:`effective_access` - preset + overrides -> ``{permission: bool}``
* :func:`access_for_user` - the signed-in user's effective access (what the sidebar and the
  module registry in ``app.core.routes`` filter by, and what ``/api/auth/me`` returns)
* :func:`branch_for_user` - the user's own branch (``user_access.branch_id``), also in the session
* :func:`active_branch_for_user` / :func:`branch_scope` - the ONE branch every branch-aware
  endpoint works on: ``users.active_branch_id`` for users with ``see_other_branches`` (they
  switch it), the user's own branch for everyone else
* :func:`require_access` - FastAPI dependency: ``Depends(require_access("manage_users"))``
  (every listed permission); :func:`require_any_access` - at least one of them

Attendance and payroll guard their endpoints and sidebar entries with these, not with roles:
``NavItem(..., permission="mark_attendance")`` in ``app.core.modules``. This module is therefore
imported even when the admin module is paused; the per-user overrides then do not exist and
:func:`access_for_user` falls back to the role preset.

Keep ``web/components/admin/permissions.ts`` in step with the constants here.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select

from app.core.auth import CurrentUser
from app.core.models import Branch, Role, User
from app.core.modules import is_enabled
from app.db import DbSession
from app.modules.admin.models import UserAccess

Access = dict[str, bool]

#: (key, label, description), in the order the screens show them.
PERMISSION_GROUPS: tuple[tuple[str, tuple[tuple[str, str, str], ...]], ...] = (
    (
        "Attendance",
        (
            ("mark_attendance", "Mark attendance", "Daily marking for their branch"),
            ("view_attendance_report", "View attendance report", "Month / week report and exports"),
            (
                "see_other_branches",
                "See other branches",
                "Branch drop-down in reports; off = own branch only",
            ),
        ),
    ),
    (
        "People & payroll",
        (
            ("manage_employees", "View & edit employees", "Profiles, photos, salary setup"),
            ("salary_advances", "Salary & advances", "Salary report, payments, advances"),
        ),
    ),
    ("Admin", (("manage_users", "Manage users", "Add users, roles, reset passwords"),)),
)

PERMISSIONS: tuple[str, ...] = tuple(key for _, items in PERMISSION_GROUPS for key, _, _ in items)
PERMISSION_LABELS: dict[str, str] = {
    key: label for _, items in PERMISSION_GROUPS for key, label, _ in items
}

ROLE_PRESETS: dict[Role, frozenset[str]] = {
    Role.admin: frozenset(PERMISSIONS),
    Role.manager: frozenset({"mark_attendance", "view_attendance_report", "manage_employees"}),
    Role.staff: frozenset({"mark_attendance"}),
}

#: Admins can never lose this one (the override is ignored).
LOCKED_FOR_ADMIN = "manage_users"

NO_ACCESS_DETAIL = "You do not have access to this page."


def preset_for(role: Role | str) -> Access:
    allowed = ROLE_PRESETS[Role(role)]
    return {key: key in allowed for key in PERMISSIONS}


def effective_access(role: Role | str, overrides: Mapping[str, object] | None) -> Access:
    """The preset of ``role`` with ``overrides`` applied (unknown keys ignored, values coerced
    to bool). ``manage_users`` stays on for admins whatever the overrides say."""
    access = preset_for(role)
    if overrides:
        for key in PERMISSIONS:
            if key in overrides:
                access[key] = bool(overrides[key])
    if Role(role) is Role.admin:
        access[LOCKED_FOR_ADMIN] = True
    return access


def is_custom(role: Role | str, access: Mapping[str, object] | None) -> bool:
    """True when ``access`` differs from the role preset ("Custom" tag in the UI)."""
    return effective_access(role, access) != preset_for(role)


def clean_overrides(role: Role | str, requested: Mapping[str, object] | None) -> Access | None:
    """What to store for a user: ``None`` when the requested access equals the preset,
    otherwise the complete effective map (so a later preset change never silently alters
    a custom user)."""
    if requested is None:
        return None
    access = effective_access(role, requested)
    return None if access == preset_for(role) else access


async def access_row_for_user(db, user: User) -> UserAccess | None:
    """The user's ``admin.user_access`` row (branch + overrides), or ``None`` when there is none
    or the admin module is paused (its table is then not managed)."""
    return await db.get(UserAccess, user.id) if is_enabled("admin") else None


async def access_for_user(db, user: User) -> Access:
    """The user's effective access. With the admin module paused there is no ``user_access``
    table to read overrides from, so everyone gets their role preset."""
    row = await access_row_for_user(db, user)
    return effective_access(user.role, row.access if row else None)


async def branch_for_user(db, user: User) -> int | None:
    """The branch the user works in (``admin.user_access.branch_id``); ``None`` for admins and
    for users without a row. Attendance and payroll scope their screens to it unless the user
    holds ``see_other_branches``."""
    row = await access_row_for_user(db, user)
    return row.branch_id if row else None


OTHER_BRANCHES = "see_other_branches"


async def first_active_branch(db) -> int | None:
    """The first active branch, A-Z (the default before a user has picked one)."""
    return await db.scalar(
        select(Branch.id).where(Branch.is_active.is_(True)).order_by(Branch.name, Branch.id)
    )


async def active_branch_for_user(db, user: User, access: Access | None = None) -> int | None:
    """The branch the whole app works on for this user. Without ``see_other_branches``: their own
    branch, always (``None`` when they have none). With it: ``users.active_branch_id`` while that
    branch exists and is active, else their own branch, else the first active branch."""
    access = access if access is not None else await access_for_user(db, user)
    own = await branch_for_user(db, user)
    if not access.get(OTHER_BRANCHES):
        return own
    for candidate in (user.active_branch_id, own):
        if candidate is not None:
            branch = await db.get(Branch, candidate)
            if branch is not None and branch.is_active:
                return branch.id
    return await first_active_branch(db)


@dataclass(frozen=True)
class BranchScope:
    #: The one branch to read / write; 0 = nothing (a user without a branch who may not switch).
    branch_id: int
    #: ``see_other_branches``: may switch, and may name another branch explicitly.
    can_switch: bool


async def branch_scope(db, user: User, requested: int | None = None) -> BranchScope:
    """Which branch an endpoint serves. ``requested`` (a ``?branch_id=``) is honoured only with
    ``see_other_branches`` (404 when it does not exist) and ignored otherwise; without it, the
    user's active branch. Never "every branch"."""
    access = await access_for_user(db, user)
    if access.get(OTHER_BRANCHES):
        if requested is not None:
            if await db.get(Branch, requested) is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such branch.")
            return BranchScope(requested, True)
        return BranchScope(await active_branch_for_user(db, user, access) or 0, True)
    return BranchScope(await branch_for_user(db, user) or 0, False)


def _check_permissions(name: str, permissions: tuple[str, ...]) -> None:
    unknown = sorted(set(permissions) - set(PERMISSIONS))
    if unknown:
        raise ValueError(f"unknown permission(s): {', '.join(unknown)}")
    if not permissions:
        raise ValueError(f"{name}() needs at least one permission")


def _access_dependency(name: str, permissions: tuple[str, ...], test):
    async def dependency(user: CurrentUser, db: DbSession) -> User:
        access = await access_for_user(db, user)
        if not test(access.get(key) for key in permissions):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=NO_ACCESS_DETAIL)
        return user

    dependency.__name__ = f"{name}_{'_'.join(permissions)}"
    return dependency


def require_access(*permissions: str):
    """Dependency factory: the signed-in user must hold every listed permission (403 otherwise).
    Combine with the module's own ``CurrentUser`` for endpoints that need no permission."""
    _check_permissions("require_access", permissions)
    return _access_dependency("require_access", permissions, all)


def require_any_access(*permissions: str):
    """Dependency factory: the signed-in user must hold at least one of the listed permissions
    (403 otherwise). Use it on a module router so anyone who can see one of its sidebar entries
    can call its shared endpoints; guard the individual endpoints with :func:`require_access`."""
    _check_permissions("require_any_access", permissions)
    return _access_dependency("require_any_access", permissions, any)


ManageUsers = Annotated[User, Depends(require_access("manage_users"))]
