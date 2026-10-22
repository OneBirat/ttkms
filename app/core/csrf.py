"""Per-session CSRF protection.

The token lives in the session (created on first use, rotated at login). Regular forms send it as
a hidden input named ``csrf_token``; HTMX sends the ``X-CSRF-Token`` header, set once on ``<body>``
via ``hx-headers`` in base.html. :func:`csrf_protect` is installed app-wide as a dependency, so
every unsafe request (POST/PUT/PATCH/DELETE) must carry a valid token.
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


async def csrf_protect(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    expected = request.session.get(SESSION_KEY)
    supplied: str | None = request.headers.get(HEADER_NAME)
    if supplied is None and request.headers.get("content-type", "").startswith(_FORM_TYPES):
        form = await request.form()  # cached on the request; the route's Form() params reuse it
        value = form.get(FORM_FIELD)
        supplied = value if isinstance(value, str) else None
    if not expected or not supplied or not secrets.compare_digest(expected, supplied):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF token missing or invalid")
