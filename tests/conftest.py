"""Shared fixtures.

The suite runs against a real Postgres database - ``settings.resolved_test_database_url``, by
default ``<database>_test`` on the same server. Once per session it is created if missing, its
five schemas are dropped and recreated, and the project's own Alembic environment is run
(``alembic -n core upgrade head``). Every test then runs inside a transaction that is rolled back,
so tests never see each other's rows.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import BASE_DIR, settings
from app.core.auth import hash_password
from app.core.models import Role, User
from app.db import get_db
from app.main import app
from migrations.env_helper import MODULES

TEST_DB_URL = settings.resolved_test_database_url

assert make_url(TEST_DB_URL).database != make_url(settings.database_url).database, (
    "TEST_DATABASE_URL must not point at the main database"
)


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


def alembic_config(url: str, module: str = "core") -> Config:
    cfg = Config(str(BASE_DIR / "alembic.ini"), ini_section=module)
    cfg.attributes["sqlalchemy_url"] = url
    return cfg


async def _ensure_database(url: str) -> None:
    target = make_url(url)
    admin = create_async_engine(
        target.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    async with admin.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.database}
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    await admin.dispose()


async def _reset_schemas(url: str) -> None:
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    async with engine.connect() as conn:
        for schema in MODULES:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> str:
    asyncio.run(_ensure_database(TEST_DB_URL))
    asyncio.run(_reset_schemas(TEST_DB_URL))
    for module in MODULES:  # core first, then every module (an empty versions/ is fine)
        command.upgrade(alembic_config(TEST_DB_URL, module), "head")
    return TEST_DB_URL


@pytest.fixture
async def db(migrated_database: str) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(migrated_database, poolclass=NullPool)
    async with engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await outer.rollback()
    await engine.dispose()


@pytest.fixture
async def client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://testserver", follow_redirects=False
    ) as client:
        yield client
    app.dependency_overrides.pop(get_db, None)


MakeUser = Callable[..., Coroutine[Any, Any, User]]


@pytest.fixture
def make_user(db: AsyncSession) -> MakeUser:
    async def _make(
        username: str = "admin",
        password: str = "secret123",
        role: Role | str = Role.admin,
        full_name: str | None = None,
        is_active: bool = True,
    ) -> User:
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name=full_name or username.replace("_", " ").title(),
            role=Role(role),
            is_active=is_active,
        )
        db.add(user)
        await db.flush()
        return user

    return _make


@pytest.fixture
def login(client: AsyncClient):
    """JSON login the way the Next.js app does it: fetch the CSRF token, then POST."""

    async def _login(
        username: str, password: str = "secret123", remember: bool = False
    ) -> Response:
        token = (await client.get("/api/auth/csrf")).json()["csrf_token"]
        response = await client.post(
            "/api/auth/login",
            json={"username": username, "password": password, "remember": remember},
            headers={"X-CSRF-Token": token},
        )
        assert response.status_code == 200, response.text
        return response

    return _login
