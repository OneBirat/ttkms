"""One-shot flash messages stored in the session (rendered once by base.html)."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request

FLASH_KEY = "_flashes"
LEVELS = ("info", "success", "warning", "danger")


def flash(request: Request, message: str, level: str = "info") -> None:
    if level not in LEVELS:
        raise ValueError(f"unknown flash level {level!r}")
    messages = list(request.session.get(FLASH_KEY, []))
    messages.append({"message": message, "level": level})
    request.session[FLASH_KEY] = messages


def pop_flashes(request: Request) -> list[dict[str, Any]]:
    if "session" not in request.scope or FLASH_KEY not in request.session:
        return []
    return list(request.session.pop(FLASH_KEY))
