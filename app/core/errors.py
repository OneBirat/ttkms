"""JSON errors with a machine-readable ``code`` next to ``detail``.

``HTTPException`` can only carry ``detail``; when the web app has to branch on *why* a request
failed (``{"detail": ..., "code": "department_in_use", "count": 3}``) raise :class:`ApiError`
instead. :func:`api_error_handler` is registered in ``app.main``; ``apiFetch`` in
``web/lib/api.ts`` reads ``code`` from the body.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ApiError(Exception):
    def __init__(self, status_code: int, detail: str, code: str, **extra: Any) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"detail": self.detail, "code": self.code, **self.extra}


class CodedErrorOut(BaseModel):
    """OpenAPI shape of an :class:`ApiError` body (extra keys allowed)."""

    model_config = {"extra": "allow"}

    detail: str
    code: str


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status_code)
