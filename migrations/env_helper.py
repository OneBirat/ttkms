"""Shared Alembic environment used by every ``migrations/<module>/env.py``.

Each module gets its own version table (``<module>.alembic_version_<module>``) and only ever
autogenerates objects that live in its own Postgres schema, so feature worktrees never clash:

* ``include_name`` limits reflection to the module's schema;
* ``include_object`` limits metadata comparison to tables in that schema.

Model modules are imported so ``Base.metadata`` is populated. ``app.core.models`` is always
imported (cross-schema FKs reference core tables) and ``app.modules.<module>.models`` is imported
automatically when it exists; pass ``model_modules`` for anything else.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
from collections.abc import Iterable
from typing import Any

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

MODULES: tuple[str, ...] = ("core", "stock", "attendance", "payroll", "admin")


def import_module_models(module: str, extra: Iterable[str] = ()) -> None:
    """Import app.core.models plus app.modules.<module>.models (when it exists) and ``extra``."""
    importlib.import_module("app.core.models")
    candidate = f"app.modules.{module}.models"
    if module != "core" and importlib.util.find_spec(candidate) is not None:
        importlib.import_module(candidate)
    for name in extra:
        importlib.import_module(name)


def version_table_for(module: str) -> str:
    return f"alembic_version_{module}"


def make_include_name(module: str):
    def include_name(name: str | None, type_: str, parent_names: dict[str, Any]) -> bool:
        if type_ == "schema":
            return name == module
        return True

    return include_name


def make_include_object(module: str):
    version_table = version_table_for(module)

    def include_object(
        obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any
    ) -> bool:
        if type_ == "table":
            return obj.schema == module and name != version_table
        table = getattr(obj, "table", None)
        if table is not None:
            return table.schema == module
        return True

    return include_object


def run_module_migrations(module: str, *, model_modules: Iterable[str] = ()) -> None:
    if module not in MODULES:
        raise ValueError(f"unknown module {module!r}; expected one of {MODULES}")

    from app.config import settings
    from app.db import Base

    config = context.config
    import_module_models(module, model_modules)

    url: str = (
        config.attributes.get("sqlalchemy_url")
        or config.get_main_option("sqlalchemy.url")
        or settings.database_url
    )

    options: dict[str, Any] = {
        "target_metadata": Base.metadata,
        "version_table": version_table_for(module),
        "version_table_schema": module,
        "include_schemas": True,
        "include_name": make_include_name(module),
        "include_object": make_include_object(module),
        "compare_type": True,
    }

    def do_run_migrations(connection: Connection) -> None:
        # Fresh databases: make sure the module's schema exists before Alembic creates its
        # version table in it. Committed separately so Alembic owns the migration transaction.
        exists = connection.scalar(
            text("SELECT 1 FROM pg_namespace WHERE nspname = :name"), {"name": module}
        )
        if exists is None:  # only then is CREATE privilege on the database needed
            connection.execute(text(f'CREATE SCHEMA "{module}"'))
        # End the auto-begun transaction either way, otherwise Alembic's begin_transaction()
        # becomes a no-op inside it and the whole upgrade is rolled back on close.
        connection.commit()
        context.configure(connection=connection, **options)
        with context.begin_transaction():
            context.run_migrations()

    async def run_async_migrations() -> None:
        engine = create_async_engine(url, poolclass=pool.NullPool)
        try:
            async with engine.connect() as connection:
                await connection.run_sync(do_run_migrations)
        finally:
            await engine.dispose()

    if context.is_offline_mode():
        context.configure(
            url=url, literal_binds=True, dialect_opts={"paramstyle": "named"}, **options
        )
        with context.begin_transaction():
            context.execute(f'CREATE SCHEMA IF NOT EXISTS "{module}"')
            context.run_migrations()
    else:
        asyncio.run(run_async_migrations())
