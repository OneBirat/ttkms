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
from app.core.modules import Module, load_modules
from app.core.sessions import SessionMiddleware

# The enabled modules (ENABLED_MODULES in .env), imported exactly once, in sidebar order. Each is
# mounted under /api/<name>; a disabled module is not imported at all.
MODULES: list[Module] = load_modules()


async def login_required_handler(request: Request, exc: auth.LoginRequired) -> JSONResponse:
    return JSONResponse({"detail": "login required"}, status_code=401)


async def password_change_required_handler(
    request: Request, exc: auth.PasswordChangeRequired
) -> JSONResponse:
    return JSONResponse(
        {
            "detail": auth.PASSWORD_CHANGE_REQUIRED_DETAIL,
            "code": auth.PASSWORD_CHANGE_REQUIRED_CODE,
        },
        status_code=403,
    )


def create_app(modules: list[Module] | None = None) -> FastAPI:
    """Build the app. ``modules`` defaults to the enabled set read from settings when called,
    so a test can monkeypatch ``settings.enabled_modules`` and build an app with stock on."""
    modules = load_modules() if modules is None else modules
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
    app.state.modules = modules
    app.add_exception_handler(auth.LoginRequired, login_required_handler)
    app.add_exception_handler(auth.PasswordChangeRequired, password_change_required_handler)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(routes.router)
    for module in modules:
        app.include_router(module.router, prefix=f"/api/{module.name}", tags=[module.name])
    return app


app = create_app(MODULES)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.app_port, reload=True)
