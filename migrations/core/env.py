"""Alembic environment for the `core` module (schema `core`).

Version table: `core.alembic_version_core`. Run with: alembic -n core upgrade head
All behaviour lives in migrations/env_helper.py so every module environment is identical.
"""

from logging.config import fileConfig

from alembic import context

from migrations.env_helper import run_module_migrations

if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name, disable_existing_loggers=False)

run_module_migrations("core")
