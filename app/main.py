"""App factory: middleware, error handlers, core API routes and module loading.

FastAPI is a JSON API under ``/api``; the Next.js app in ``web/`` proxies ``/api/*`` to it so the
session cookie stays same-origin.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.core import auth, routes
from app.core.csrf import csrf_protect
from app.core.modules import Module
from app.core.sessions import SessionMiddleware
from app.modules import admin, attendance, payroll, stock

# The four modules, imported exactly once, in sidebar order. Each is mounted under /api/<name>.
MODULES: list[Module] = [stock.module, attendance.module, payroll.module, admin.module]


async def login_required_handler(request: Request, exc: auth.LoginRequired) -> JSONResponse:
    return JSONResponse({"detail": "login required"}, status_code=401)


def create_app() -> FastAPI:
    # Swagger UI loads from a CDN: dev only (a LAN deployment may have no internet).
    app = FastAPI(
        title="TTK API",
        docs_url=None if settings.is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/api/openapi.json",
        dependencies=[Depends(csrf_protect)],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.secret_key,
        session_cookie=settings.session_cookie,
        max_age=settings.session_max_age_days * 24 * 60 * 60,
        same_site="lax",
        https_only=settings.session_https_only,
    )
    app.state.modules = MODULES
    app.add_exception_handler(auth.LoginRequired, login_required_handler)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(routes.router)
    for module in MODULES:
        app.include_router(module.router, prefix=f"/api/{module.name}", tags=[module.name])
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.app_port, reload=True)
