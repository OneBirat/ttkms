"""Async database layer: engine, session factory, FastAPI dependency and declarative Base.

Every model - core and module - inherits from :class:`Base` and declares
``__table_args__ = {"schema": "<module>"}``. All tables share one MetaData (so cross-schema
foreign keys resolve) while living in their own Postgres schema.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Deterministic constraint names: migrations and models agree without hand-naming everything.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def make_engine(url: str | None = None, **kwargs: Any) -> AsyncEngine:
    return create_async_engine(url or settings.database_url, pool_pre_ping=True, **kwargs)


engine: AsyncEngine = make_engine()
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request. Routes commit explicitly."""
    async with SessionLocal() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]
