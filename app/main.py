"""App factory: middleware, static files, error handlers, core routes and module loading."""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler as fastapi_http_exception_handler
from fastapi.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from app.config import STATIC_DIR, settings
from app.core import auth, routes
from app.core.csrf import csrf_protect
from app.core.modules import Module
from app.core.sessions import SessionMiddleware
from app.core.templating import render
from app.modules import admin, attendance, payroll, stock

# The four modules, imported exactly once, in sidebar order. Each is mounted under /<name>.
MODULES: list[Module] = [stock.module, attendance.module, payroll.module, admin.module]


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> Response:
    wants_html = "text/html" in request.headers.get("accept", "") or bool(
        request.headers.get("HX-Request")
    )
    if exc.status_code in (403, 404) and wants_html:
        return render(
            request,
            f"errors/{exc.status_code}.html",
            {"detail": exc.detail},
            status_code=exc.status_code,
        )
    return await fastapi_http_exception_handler(request, exc)


def create_app() -> FastAPI:
    # Swagger/ReDoc UIs load from a CDN, which a LAN deployment may not reach: keep only the JSON.
    app = FastAPI(
        title="TTK",
        docs_url=None,
        redoc_url=None,
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
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.state.modules = MODULES

    app.add_exception_handler(auth.LoginRequired, auth.login_required_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(routes.router)
    for module in MODULES:
        app.include_router(module.router, prefix=f"/{module.name}", tags=[module.name])
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.app_port, reload=True)
