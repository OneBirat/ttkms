"""Small core services shared by routes, the CLI and module worktrees."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import AuditLog, Branch, Department, Setting, normalize_name

DEFAULT_SETTINGS: dict[str, Any] = {
    "late_after": "09:30",
    "weekly_off": ["sat"],
    "company_name": "TTK",
}


async def get_setting(db: AsyncSession, key: str, default: Any = None) -> Any:
    row = await db.get(Setting, key)
    return default if row is None else row.value


async def set_setting(db: AsyncSession, key: str, value: Any) -> None:
    stmt = pg_insert(Setting).values(key=key, value=value)
    stmt = stmt.on_conflict_do_update(index_elements=[Setting.key], set_={"value": value})
    await db.execute(stmt)


async def company_name(db: AsyncSession) -> str:
    return str(await get_setting(db, "company_name", DEFAULT_SETTINGS["company_name"]))


async def find_branch(db: AsyncSession, name: str) -> Branch | None:
    return await db.scalar(select(Branch).where(Branch.name_norm == normalize_name(name)))


async def find_department(db: AsyncSession, name: str) -> Department | None:
    return await db.scalar(select(Department).where(Department.name_norm == normalize_name(name)))


async def record_audit(
    db: AsyncSession,
    *,
    module: str,
    action: str,
    entity: str,
    entity_id: int | str | None = None,
    user_id: int | None = None,
    data: dict[str, Any] | None = None,
) -> AuditLog:
    """Append an audit row (not committed - the caller owns the transaction)."""
    row = AuditLog(
        user_id=user_id,
        module=module,
        action=action,
        entity=entity,
        entity_id=None if entity_id is None else str(entity_id),
        data=data,
    )
    db.add(row)
    await db.flush()
    return row
