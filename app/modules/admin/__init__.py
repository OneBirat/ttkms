"""Admin module: users & access, payment modes, barcode stickers.

Routes are mounted under ``/api/admin``. Access is checked per route with
:func:`app.modules.admin.permissions.require_access` (``manage_users`` for everything an admin
does here); the sidebar entries are role-based because the registry only knows roles.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.core.auth import CurrentUser, require_role
from app.core.export import PDF_MEDIA_TYPE, PDFUnavailable
from app.core.models import User
from app.core.modules import Module, NavItem, coming_soon_widget
from app.core.schemas import ModuleStatusOut
from app.core.services import company_name
from app.db import DbSession
from app.modules.admin import services
from app.modules.admin.barcodes import DEFAULT_SIZE, STICKER_SIZES, sticker_pdf
from app.modules.admin.permissions import (
    PERMISSION_GROUPS,
    ROLE_PRESETS,
    ManageUsers,
    require_access,
)
from app.modules.admin.schemas import (
    ActiveIn,
    AdminUserOut,
    BarcodesOut,
    PaymentModeActiveIn,
    PaymentModeIn,
    PaymentModeOut,
    PermissionGroupOut,
    PermissionOut,
    PermissionsOut,
    StickerSizeOut,
    TemporaryPasswordOut,
    UserCreatedOut,
    UserIn,
    UserOptionsOut,
)

ROLES = {"admin"}
#: Payment modes and barcodes are admin-only screens (no per-user switch for them).
AdminOnly = Annotated[User, Depends(require_role(*ROLES))]

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


# ----------------------------------------------------------------------------- payment modes


@router.get("/payment-modes", response_model=list[PaymentModeOut], name="admin:payment_modes")
async def list_payment_modes(
    user: CurrentUser, db: DbSession, active: bool = False
) -> list[PaymentModeOut]:
    """Cash first, then the admin-managed modes. ``?active=1`` is what payroll reads when
    someone records a payment (any signed-in user)."""
    return await services.list_payment_modes(db, active_only=active)


@router.post(
    "/payment-modes",
    response_model=PaymentModeOut,
    status_code=status.HTTP_201_CREATED,
    name="admin:create_payment_mode",
)
async def create_payment_mode(
    me: AdminOnly, db: DbSession, payload: PaymentModeIn
) -> PaymentModeOut:
    mode = await services.create_payment_mode(db, me, payload)
    return services.mode_out(mode, await services.payment_counts(db))


@router.put(
    "/payment-modes/{mode_id}", response_model=PaymentModeOut, name="admin:update_payment_mode"
)
async def update_payment_mode(
    mode_id: int, me: AdminOnly, db: DbSession, payload: PaymentModeIn
) -> PaymentModeOut:
    mode = await services.get_mode_or_404(db, mode_id)
    mode = await services.update_payment_mode(db, me, mode, payload)
    return services.mode_out(mode, await services.payment_counts(db))


@router.post(
    "/payment-modes/{mode_id}/active",
    response_model=PaymentModeOut,
    name="admin:payment_mode_active",
)
async def set_payment_mode_active(
    mode_id: int, me: AdminOnly, db: DbSession, payload: PaymentModeActiveIn
) -> PaymentModeOut:
    """Turning a mode off hides it from new payments; old payments keep it."""
    mode = await services.get_mode_or_404(db, mode_id)
    mode = await services.set_payment_mode_active(db, me, mode, payload.active)
    return services.mode_out(mode, await services.payment_counts(db))


# ----------------------------------------------------------------------------- barcodes


def _pdf_available() -> bool:
    try:
        import weasyprint  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


@router.get("/barcodes", response_model=BarcodesOut, name="admin:barcodes")
async def barcodes_index(me: AdminOnly, db: DbSession) -> BarcodesOut:
    """Active employees to print stickers for, the sticker sizes, and whether the server can
    render the PDF (WeasyPrint needs pango; the page prints from the browser either way)."""
    return BarcodesOut(
        employees=await services.barcode_employees(db),
        sizes=[
            StickerSizeOut(
                key=s.key, label=s.label, columns=s.columns, rows=s.rows, per_page=s.per_page
            )
            for s in STICKER_SIZES.values()
        ],
        pdf_available=_pdf_available(),
    )


@router.get("/barcodes.pdf", name="admin:barcodes_pdf", include_in_schema=False)
async def barcodes_pdf(
    me: AdminOnly,
    db: DbSession,
    ids: str = Query(..., description="comma-separated employee ids"),
    size: str = DEFAULT_SIZE,
) -> Response:
    """A4 sticker sheet(s) for the given employees (503 while WeasyPrint is unavailable)."""
    sticker_size = STICKER_SIZES.get(size)
    if sticker_size is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown sticker size.")
    try:
        wanted = [int(part) for part in ids.split(",") if part.strip()]
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="ids must be numbers."
        ) from exc
    employees = await services.employees_by_ids(db, wanted)
    if not employees:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Select at least one employee."
        )
    company = await company_name(db)
    try:
        pdf = await run_in_threadpool(
            sticker_pdf, employees, sticker_size, company=company, printed_by=me.full_name
        )
    except PDFUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return Response(
        pdf,
        media_type=PDF_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="ttk-barcodes.pdf"'},
    )


NAV = [
    NavItem(label="Users", path="/admin/users", icon="user", roles=set(ROLES)),
    NavItem(label="Barcodes", path="/admin/barcodes", icon="barcode", roles=set(ROLES)),
    NavItem(label="Payment modes", path="/admin/payment-modes", icon="card", roles=set(ROLES)),
]

module = Module(
    name="admin",
    title="Admin",
    router=router,
    nav=NAV,
    dashboard_widgets=[coming_soon_widget("Admin", "Users, barcodes and payment modes")],
)

__all__ = ["module", "router", "require_access"]
