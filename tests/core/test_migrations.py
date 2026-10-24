"""The per-module Alembic setup: own version table, schema-scoped autogenerate, no drift."""

import asyncio

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.db import Base
from migrations.env_helper import (
    import_module_models,
    make_include_name,
    make_include_object,
    version_table_for,
)
from tests.conftest import MIGRATED_MODULES, _ensure_database, _reset_schemas, alembic_config

CORE_TABLES = {"branches", "departments", "employees", "users", "settings", "audit_log"}


def _run(coro):
    return asyncio.run(coro)


async def _tables(url: str, schema: str) -> set[str]:
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            return set(await conn.run_sync(lambda c: inspect(c).get_table_names(schema=schema)))
    finally:
        await engine.dispose()


async def _version(url: str, module: str) -> list[str]:
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(f'SELECT version_num FROM "{module}".{version_table_for(module)}')
            )
            return [r[0] for r in rows]
    finally:
        await engine.dispose()


async def _diffs(url: str, module: str) -> list:
    import_module_models(module)

    def compare(sync_conn):
        ctx = MigrationContext.configure(
            sync_conn,
            opts={
                "compare_type": True,
                "include_schemas": True,
                "include_name": make_include_name(module),
                "include_object": make_include_object(module),
                "version_table": version_table_for(module),
                "version_table_schema": module,
            },
        )
        return compare_metadata(ctx, Base.metadata)

    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(compare)
    finally:
        await engine.dispose()


def _heads(url: str, module: str) -> list[str]:
    return list(ScriptDirectory.from_config(alembic_config(url, module)).get_heads())


def test_core_upgrade_creates_tables_and_version_table(migrated_database):
    assert CORE_TABLES <= _run(_tables(migrated_database, "core"))
    assert version_table_for("core") in _run(_tables(migrated_database, "core"))
    assert _run(_version(migrated_database, "core")) == _heads(migrated_database, "core")


def test_models_and_migrations_do_not_drift(migrated_database):
    assert _run(_diffs(migrated_database, "core")) == []


@pytest.mark.parametrize("module", [m for m in MIGRATED_MODULES if m != "core"])
def test_module_environments_are_isolated(migrated_database, module):
    """Each enabled module owns its version table in its own schema, is at its own head (none
    while it has no migrations), and comparing its metadata never reports core tables."""
    assert version_table_for(module) in _run(_tables(migrated_database, module))
    assert _run(_version(migrated_database, module)) == _heads(migrated_database, module)
    assert _run(_diffs(migrated_database, module)) == []
    assert CORE_TABLES <= _run(_tables(migrated_database, "core"))


def test_core_downgrade_and_upgrade_roundtrip(migrated_database):
    """Runs in a throwaway database so module tables in the shared test DB (which may reference
    core.employees) are never dropped underneath other tests."""
    url = make_url(migrated_database)
    scratch = url.set(database=f"{url.database}_roundtrip").render_as_string(hide_password=False)
    _run(_ensure_database(scratch))
    _run(_reset_schemas(scratch))
    cfg = alembic_config(scratch)
    command.upgrade(cfg, "head")
    assert CORE_TABLES <= _run(_tables(scratch, "core"))
    command.downgrade(cfg, "base")
    assert _run(_tables(scratch, "core")) & CORE_TABLES == set()
    command.upgrade(cfg, "head")
    assert CORE_TABLES <= _run(_tables(scratch, "core"))
    assert _run(_diffs(scratch, "core")) == []
