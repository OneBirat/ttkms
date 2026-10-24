"""Authentication: JSON login/logout, the current-user dependency and the role guard.

* ``GET /api/auth/csrf``, ``POST /api/auth/login``, ``GET /api/auth/me``, ``POST /api/auth/logout``
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
from sqlalchemy import select

from app.config import settings
from app.core.csrf import get_csrf_token, rotate_csrf_token
from app.core.models import Role, User, is_phone, normalize_phone, normalize_username
from app.core.schemas import CsrfOut, ErrorOut, LoginIn, SessionOut, UserOut
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
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


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
    return SessionOut(user=UserOut.from_user(user), csrf_token=token)


@router.get("/me", response_model=SessionOut, responses={401: {"model": ErrorOut}})
async def me(request: Request, user: CurrentUser) -> SessionOut:
    return SessionOut(user=UserOut.from_user(user), csrf_token=get_csrf_token(request))


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
