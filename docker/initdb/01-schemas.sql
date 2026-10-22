-- Runs once when the Postgres volume is first initialised (docker-entrypoint-initdb.d).
-- One schema per module; Alembic also creates its own schema if missing.
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS stock;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS payroll;
CREATE SCHEMA IF NOT EXISTS admin;
