"""Per-user access (design/final/AdminUsers.dc.html, "Access" tab).

A role is only the *starting preset*; every permission can be switched on or off per user.
Admins always keep ``manage_users`` so the system cannot be locked out.

* :data:`PERMISSIONS` / :data:`PERMISSION_GROUPS` - the six switches, in display order
* :data:`ROLE_PRESETS` - Admin = all; Manager = mark attendance, view attendance report,
  view & edit employees; Staff = mark attendance only
* :func:`effective_access` - preset + overrides -> ``{permission: bool}``
* :func:`require_access` - FastAPI dependency: ``Depends(require_access("manage_users"))``

Attendance and payroll should guard their endpoints with :func:`require_access` instead of
``require_role`` (see the final report of the admin session).

Keep ``web/components/admin/permissions.ts`` in step with the constants here.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.auth import CurrentUser
from app.core.models import Role, User
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


async def access_for_user(db, user: User) -> Access:
    row = await db.get(UserAccess, user.id)
    return effective_access(user.role, row.access if row else None)


def require_access(*permissions: str):
    """Dependency factory: the signed-in user must hold every listed permission (403 otherwise).
    Combine with the module's own ``CurrentUser`` for endpoints that need no permission."""
    unknown = sorted(set(permissions) - set(PERMISSIONS))
    if unknown:
        raise ValueError(f"unknown permission(s): {', '.join(unknown)}")
    if not permissions:
        raise ValueError("require_access() needs at least one permission")

    async def dependency(user: CurrentUser, db: DbSession) -> User:
        access = await access_for_user(db, user)
        if not all(access.get(key) for key in permissions):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=NO_ACCESS_DETAIL)
        return user

    dependency.__name__ = f"require_access_{'_'.join(permissions)}"
    return dependency


ManageUsers = Annotated[User, Depends(require_access("manage_users"))]
