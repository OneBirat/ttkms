"""Alembic environment for the `attendance` module (schema `attendance`).

Version table: `attendance.alembic_version_attendance`. Run with: alembic -n attendance upgrade head
All behaviour lives in migrations/env_helper.py so every module environment is identical.
"""

from logging.config import fileConfig

from alembic import context

from migrations.env_helper import run_module_migrations

if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name)

run_module_migrations("attendance")
