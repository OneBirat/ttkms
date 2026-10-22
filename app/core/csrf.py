"""Per-session CSRF protection.

The token lives in the session (created on first use, rotated at login) and is handed to the
client by ``GET /api/auth/csrf``, ``POST /api/auth/login`` and ``GET /api/auth/me``. JSON clients
send it as the ``X-CSRF-Token`` header; plain HTML forms may send it as a ``csrf_token`` field.
:func:`csrf_protect` is installed app-wide as a dependency, so every unsafe request
(POST/PUT/PATCH/DELETE) must carry a valid token.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status

SESSION_KEY = "csrf_token"
HEADER_NAME = "X-CSRF-Token"
FORM_FIELD = "csrf_token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
_FORM_TYPES = ("application/x-www-form-urlencoded", "multipart/form-data")


def get_csrf_token(request: Request) -> str:
    token = request.session.get(SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        request.session[SESSION_KEY] = token
    return token


def rotate_csrf_token(request: Request) -> str:
    token = secrets.token_urlsafe(32)
    request.session[SESSION_KEY] = token
    return token


def _matches(expected: str, supplied: str) -> bool:
    # compare_digest on str requires ASCII; compare encoded bytes so odd input is a 403, not a 500.
    return secrets.compare_digest(
        expected.encode("utf-8", "replace"), supplied.encode("utf-8", "replace")
    )


async def csrf_protect(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    expected = request.session.get(SESSION_KEY)
    supplied: str | None = request.headers.get(HEADER_NAME)
    if supplied is None and request.headers.get("content-type", "").startswith(_FORM_TYPES):
        form = await request.form()  # cached on the request; the route's Form() params reuse it
        value = form.get(FORM_FIELD)
        supplied = value if isinstance(value, str) else None
    if not expected or not supplied or not _matches(expected, supplied):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF token missing or invalid")
