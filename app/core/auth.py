"""Authentication: JSON login/logout, the current-user dependency and the role guard.

* ``GET /api/auth/csrf``, ``POST /api/auth/login``, ``GET /api/auth/me``, ``POST /api/auth/logout``
  (login / me / change-password answer :class:`SessionOut`: the user, the CSRF token, the user's
  own ``branch_id`` and their effective permissions from ``app.modules.admin.permissions``)
* :func:`get_current_user` (``CurrentUser``) raises :class:`LoginRequired`, which the app turns
  into a ``401 {"detail": "login required"}`` response
* :func:`require_role` - ``Depends(require_role("admin", "manager"))`` -> 403 for other roles

Sessions are signed cookies (stateless). Without "Keep me signed in" the cookie dies with the
browser and the session is additionally rejected server-side after
``settings.session_short_max_age_hours``; with it the cookie lives
``settings.session_max_age_days``. Logging out clears the cookie but cannot revoke a copy of it.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from functools import cache
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import func, select

from app.config import settings
from app.core.csrf import get_csrf_token, rotate_csrf_token
from app.core.models import (
    Branch,
    Employee,
    EmployeeStatus,
    Role,
    User,
    is_phone,
    normalize_phone,
    normalize_username,
)
from app.core.schemas import (
    ActiveBranchIn,
    ActiveBranchOut,
    BranchOptionOut,
    ChangePasswordIn,
    CsrfOut,
    ErrorOut,
    LoginIn,
    SessionOut,
    UserOut,
)
from app.core.services import record_audit
from app.core.sessions import PERSIST_KEY
from app.db import DbSession

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_USER_KEY = "user_id"
SESSION_ISSUED_KEY = "_issued"
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


@cache
def _dummy_hash() -> str:
    """Verified against when the username is unknown, so both outcomes take similar time."""
    return hash_password("not-a-real-password")


class LoginRequired(Exception):
    pass


class PasswordChangeRequired(Exception):
    """The signed-in user still has the temporary password an admin gave them. Everything but
    ``/api/auth/*`` answers 403 with ``code: password_change_required`` until they change it."""


PASSWORD_CHANGE_REQUIRED_CODE = "password_change_required"
PASSWORD_CHANGE_REQUIRED_DETAIL = "Set a new password before continuing."
MIN_PASSWORD_LENGTH = 8
#: Routes a user with a temporary password may still call.
_PASSWORD_CHANGE_EXEMPT_PREFIX = "/api/auth/"


def _session_expired(request: Request) -> bool:
    if request.session.get(PERSIST_KEY):
        return False
    issued = request.session.get(SESSION_ISSUED_KEY)
    if not isinstance(issued, int | float):
        return True
    return time.time() - issued > settings.session_short_max_age_hours * 3600


async def get_current_user(request: Request, db: DbSession) -> User:
    user_id = request.session.get(SESSION_USER_KEY)
    if user_id is None:
        raise LoginRequired()
    if _session_expired(request):
        request.session.clear()
        raise LoginRequired()
    user = await db.get(User, int(user_id))
    if user is None or not user.is_active:
        request.session.clear()
        raise LoginRequired()
    if user.must_change_password and not request.url.path.startswith(
        _PASSWORD_CHANGE_EXEMPT_PREFIX
    ):
        raise PasswordChangeRequired()
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_optional_user(request: Request, db: DbSession) -> User | None:
    """The signed-in user, or ``None`` for an anonymous (or expired / password-change-pending)
    session - for endpoints that are public but say more to a signed-in caller."""
    try:
        return await get_current_user(request, db)
    except (LoginRequired, PasswordChangeRequired):
        return None


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def session_out(db, user: User, csrf_token: str) -> SessionOut:
    """The session body: user, token, own branch and effective access. The admin module owns the
    permission catalogue and imports this module, so it is imported here lazily."""
    from app.modules.admin.permissions import (
        access_for_user,
        active_branch_for_user,
        branch_for_user,
    )

    access = await access_for_user(db, user)
    branch_id = await branch_for_user(db, user)
    branch = await db.get(Branch, branch_id) if branch_id is not None else None
    active_id = await active_branch_for_user(db, user, access)
    active = await db.get(Branch, active_id) if active_id is not None else None
    return SessionOut(
        user=UserOut.from_user(user),
        csrf_token=csrf_token,
        branch_id=branch_id,
        branch_name=branch.name if branch else None,
        active_branch=ActiveBranchOut(id=active.id, name=active.name) if active else None,
        branches=await branch_options(db) if access.get("see_other_branches") else None,
        access=access,
    )


async def branch_options(db) -> list[BranchOptionOut]:
    """Every active branch A-Z with its active staff count."""
    staff = dict(
        (
            await db.execute(
                select(Employee.branch_id, func.count())
                .where(Employee.status == EmployeeStatus.active)
                .group_by(Employee.branch_id)
            )
        ).all()
    )
    rows = await db.scalars(
        select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.name, Branch.id)
    )
    return [BranchOptionOut(id=b.id, name=b.name, staff=int(staff.get(b.id, 0))) for b in rows]


def require_role(*roles: str | Role):
    """Dependency factory: the signed-in user must have one of ``roles`` (403 otherwise)."""
    allowed = {Role(role).value for role in roles}
    if not allowed:
        raise ValueError("require_role() needs at least one role")

    async def dependency(user: CurrentUser) -> User:
        if user.role.value not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail="You do not have access to this page."
            )
        return user

    dependency.__name__ = f"require_role_{'_'.join(sorted(allowed))}"
    return dependency


def require_access(*permissions: str):
    """Dependency factory for core endpoints: the signed-in user must hold every listed
    permission switch (403 otherwise). The admin module owns the permission catalogue, so this
    delegates to ``app.modules.admin.permissions.require_access``; with the admin module paused
    there is no ``user_access`` table and everyone gets their role preset."""
    from app.modules.admin.permissions import require_access as admin_require_access

    return admin_require_access(*permissions)


@router.get("/csrf", response_model=CsrfOut)
async def csrf(request: Request) -> CsrfOut:
    """Returns the CSRF token for this session (and starts a session if there is none)."""
    return CsrfOut(csrf_token=get_csrf_token(request))


LOGIN_FAILED = "Invalid phone, username or password."


async def find_login_user(db, identifier: str) -> User | None:
    """The user a sign-in identifier belongs to: a phone number when it looks like one
    (``98XXXXXXXX``, optionally with spaces or +977), otherwise a username."""
    if is_phone(identifier):
        return await db.scalar(select(User).where(User.phone == normalize_phone(identifier)))
    return await db.scalar(select(User).where(User.username == normalize_username(identifier)))


@router.post(
    "/login",
    response_model=SessionOut,
    responses={401: {"model": ErrorOut}, 403: {"model": ErrorOut}},
)
async def login(request: Request, db: DbSession, payload: LoginIn) -> SessionOut:
    user = await find_login_user(db, payload.username)
    # Always run one argon2 verification so unknown, inactive and wrong-password all take as long.
    password_ok = verify_password(user.password_hash if user else _dummy_hash(), payload.password)
    if user is None or not user.is_active or not password_ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    user.last_login_at = datetime.now(UTC)
    await record_audit(
        db, module="core", action="login", entity="user", entity_id=user.id, user_id=user.id
    )
    await db.commit()

    request.session.clear()
    request.session[SESSION_USER_KEY] = user.id
    request.session[PERSIST_KEY] = payload.remember
    request.session[SESSION_ISSUED_KEY] = int(time.time())
    token = rotate_csrf_token(request)
    request.state.user = user
    return await session_out(db, user, token)


@router.get("/me", response_model=SessionOut, responses={401: {"model": ErrorOut}})
async def me(request: Request, db: DbSession, user: CurrentUser) -> SessionOut:
    return await session_out(db, user, get_csrf_token(request))


@router.post(
    "/change-password",
    response_model=SessionOut,
    responses={400: {"model": ErrorOut}, 401: {"model": ErrorOut}},
)
async def change_password(
    request: Request, db: DbSession, user: CurrentUser, payload: ChangePasswordIn
) -> SessionOut:
    """Replace the signed-in user's password (also the forced step after a temporary password).
    The current password must match; the new one must be different and at least 8 characters
    (the schema enforces the length)."""
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Current password is wrong.")
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Choose a password you have not used just now."
        )
    was_forced = user.must_change_password
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    await record_audit(
        db,
        module="core",
        action="change_password",
        entity="user",
        entity_id=user.id,
        user_id=user.id,
        data={"forced": was_forced},
    )
    await db.commit()
    return await session_out(db, user, rotate_csrf_token(request))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def logout(request: Request, db: DbSession) -> Response:
    user_id = request.session.get(SESSION_USER_KEY)
    if user_id is not None:
        await record_audit(
            db, module="core", action="logout", entity="user", entity_id=user_id, user_id=user_id
        )
        await db.commit()
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


#: ``/api/me/...``: the signed-in user's own settings.
me_router = APIRouter(prefix="/api/me", tags=["auth"])


@me_router.put(
    "/active-branch",
    response_model=SessionOut,
    responses={401: {"model": ErrorOut}, 403: {"model": ErrorOut}, 422: {"model": ErrorOut}},
)
async def set_active_branch(
    request: Request, db: DbSession, user: CurrentUser, payload: ActiveBranchIn
) -> SessionOut:
    """Switch the ONE branch the whole app works on. With ``see_other_branches`` any active
    branch; without it only their own (403 for any other). Unknown or inactive branch: 422. Kept
    on the user (survives logins, every tab); audit-logged. Returns the updated session."""
    from app.modules.admin.permissions import (
        OTHER_BRANCHES,
        access_for_user,
        active_branch_for_user,
        branch_for_user,
    )

    access = await access_for_user(db, user)
    branch = await db.get(Branch, payload.branch_id)
    if branch is None or not branch.is_active:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Pick one of the active branches."
        )
    if not access.get(OTHER_BRANCHES) and branch.id != await branch_for_user(db, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="You can only work in your own branch."
        )
    before = await active_branch_for_user(db, user, access)
    user.active_branch_id = branch.id
    await record_audit(
        db,
        module="core",
        action="active_branch",
        entity="user",
        entity_id=user.id,
        user_id=user.id,
        data={"before": {"branch_id": before}, "after": {"branch_id": branch.id}},
    )
    await db.commit()
    return await session_out(db, user, get_csrf_token(request))
