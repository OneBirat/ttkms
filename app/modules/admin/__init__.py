"""Admin module: users & access, payment modes, barcode stickers.

Routes are mounted under ``/api/admin``. Access is checked per route with
:func:`app.modules.admin.permissions.require_access` (``manage_users`` for everything an admin
does here); the sidebar entries are role-based because the registry only knows roles.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.core.auth import CurrentUser, require_role
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut
from app.db import DbSession
from app.modules.admin import services
from app.modules.admin.permissions import (
    PERMISSION_GROUPS,
    ROLE_PRESETS,
    ManageUsers,
    require_access,
)
from app.modules.admin.schemas import (
    ActiveIn,
    AdminUserOut,
    PermissionGroupOut,
    PermissionOut,
    PermissionsOut,
    TemporaryPasswordOut,
    UserCreatedOut,
    UserIn,
    UserOptionsOut,
)

ROLES = {"admin"}

router = APIRouter()


@router.get(
    "",
    response_model=ModuleStatusOut,
    name="admin:index",
    dependencies=[Depends(require_role(*ROLES))],
)
async def index() -> ModuleStatusOut:
    return ModuleStatusOut(module="admin", title="Admin", status="ready")


@router.get("/permissions", response_model=PermissionsOut, name="admin:permissions")
async def permission_catalogue(user: CurrentUser) -> PermissionsOut:
    """The permission catalogue and role presets (what the Access tab renders)."""
    return PermissionsOut(
        groups=[
            PermissionGroupOut(
                title=title,
                items=[
                    PermissionOut(key=key, label=label, description=description)
                    for key, label, description in items
                ],
            )
            for title, items in PERMISSION_GROUPS
        ],
        presets={role.value: sorted(keys) for role, keys in ROLE_PRESETS.items()},
    )


# ----------------------------------------------------------------------------- users


@router.get("/users", response_model=list[AdminUserOut], name="admin:users")
async def list_users(me: ManageUsers, db: DbSession) -> list[AdminUserOut]:
    """Every user with their effective permissions (the "View access" table)."""
    return await services.list_users(db, me)


@router.get("/users/options", response_model=UserOptionsOut, name="admin:user_options")
async def user_options(me: ManageUsers, db: DbSession) -> UserOptionsOut:
    return await services.user_options(db)


@router.post(
    "/users",
    response_model=UserCreatedOut,
    status_code=status.HTTP_201_CREATED,
    name="admin:create_user",
)
async def create_user(me: ManageUsers, db: DbSession, payload: UserIn) -> UserCreatedOut:
    user, temporary = await services.create_user(db, me, payload)
    return UserCreatedOut(
        user=await services.get_user_out(db, user, me), temporary_password=temporary
    )


@router.put("/users/{user_id}", response_model=AdminUserOut, name="admin:update_user")
async def update_user(
    user_id: int, me: ManageUsers, db: DbSession, payload: UserIn
) -> AdminUserOut:
    user = await services.get_user_or_404(db, user_id)
    user = await services.update_user(db, me, user, payload)
    return await services.get_user_out(db, user, me)


@router.post("/users/{user_id}/active", response_model=AdminUserOut, name="admin:user_active")
async def set_user_active(
    user_id: int, me: ManageUsers, db: DbSession, payload: ActiveIn
) -> AdminUserOut:
    user = await services.get_user_or_404(db, user_id)
    user = await services.set_user_active(db, me, user, payload.is_active)
    return await services.get_user_out(db, user, me)


@router.post(
    "/users/{user_id}/reset-password",
    response_model=TemporaryPasswordOut,
    name="admin:reset_password",
)
async def reset_password(user_id: int, me: ManageUsers, db: DbSession) -> TemporaryPasswordOut:
    """A new temporary password, shown once; the user must set their own at next sign-in."""
    user = await services.get_user_or_404(db, user_id)
    temporary = await services.reset_password(db, me, user)
    return TemporaryPasswordOut(
        user_id=user.id, full_name=user.full_name, temporary_password=temporary
    )


NAV = [
    NavItem(label="Users", path="/admin/users", icon="user", roles=set(ROLES)),
]

module = Module(
    name="admin",
    title="Admin",
    router=router,
    nav=NAV,
    dashboard_widgets=[coming_soon_widget("Admin", "Users, barcodes and payment modes")],
)

__all__ = ["module", "router", "require_access"]
