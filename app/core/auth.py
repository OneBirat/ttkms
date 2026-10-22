"""Authentication: session-cookie login, the current-user dependency and the role guard.

* ``GET/POST /login``, ``POST /logout``
* :func:`get_current_user` (``CurrentUser``) - raises :class:`LoginRequired`, which the app turns
  into a redirect to ``/login?next=...`` (or ``HX-Redirect`` for HTMX requests)
* :func:`require_role` - ``Depends(require_role("admin", "manager"))`` -> 403 for other roles
"""

from __future__ import annotations

from datetime import UTC, datetime
from functools import cache
from typing import Annotated
from urllib.parse import quote

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select

from app.core.csrf import rotate_csrf_token
from app.core.models import Role, User, normalize_username
from app.core.services import record_audit
from app.core.sessions import PERSIST_KEY
from app.core.templating import render
from app.db import DbSession

router = APIRouter(tags=["auth"])

SESSION_USER_KEY = "user_id"
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


def is_safe_next(url: str | None) -> bool:
    """Only same-site absolute paths are accepted as post-login redirects."""
    return bool(url) and url.startswith("/") and not url.startswith("//") and "\\" not in url


class LoginRequired(Exception):
    def __init__(self, next_url: str = "/") -> None:
        super().__init__("login required")
        self.next_url = next_url


def _current_path(request: Request) -> str:
    query = f"?{request.url.query}" if request.url.query else ""
    return f"{request.url.path}{query}"


async def get_current_user(request: Request, db: DbSession) -> User:
    user_id = request.session.get(SESSION_USER_KEY)
    if user_id is None:
        raise LoginRequired(_current_path(request))
    user = await db.get(User, int(user_id))
    if user is None or not user.is_active:
        request.session.clear()
        raise LoginRequired(_current_path(request))
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


def login_required_handler(request: Request, exc: LoginRequired) -> Response:
    next_url = exc.next_url if is_safe_next(exc.next_url) else "/"
    login_url = "/login" if next_url == "/" else f"/login?next={quote(next_url, safe='/?=&')}"
    if request.headers.get("HX-Request"):
        return Response(
            status_code=status.HTTP_401_UNAUTHORIZED, headers={"HX-Redirect": login_url}
        )
    return RedirectResponse(login_url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/login", name="login")
async def login_form(request: Request, next: str = "/") -> Response:
    if request.session.get(SESSION_USER_KEY):
        return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    return render(request, "login.html", {"next": next if is_safe_next(next) else "/"})


@router.post("/login", name="login_submit")
async def login_submit(
    request: Request,
    db: DbSession,
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    remember: Annotated[bool, Form()] = False,
    next: Annotated[str, Form()] = "/",
) -> Response:
    next_url = next if is_safe_next(next) else "/"
    uname = normalize_username(username)
    user = await db.scalar(select(User).where(User.username == uname))
    ok = user is not None and user.is_active and verify_password(user.password_hash, password)
    if user is None:
        verify_password(_dummy_hash(), password)
    if not ok:
        return render(
            request,
            "login.html",
            {"next": next_url, "username": username, "error": "Invalid username or password."},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    assert user is not None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = datetime.now(UTC)
    await record_audit(
        db, module="core", action="login", entity="user", entity_id=user.id, user_id=user.id
    )
    await db.commit()

    request.session.clear()
    request.session[SESSION_USER_KEY] = user.id
    request.session[PERSIST_KEY] = bool(remember)
    rotate_csrf_token(request)
    return RedirectResponse(next_url, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/logout", name="logout")
async def logout(request: Request, db: DbSession) -> Response:
    user_id = request.session.get(SESSION_USER_KEY)
    if user_id is not None:
        await record_audit(
            db, module="core", action="logout", entity="user", entity_id=user_id, user_id=user_id
        )
        await db.commit()
    request.session.clear()
    return RedirectResponse("/login", status_code=status.HTTP_303_SEE_OTHER)
