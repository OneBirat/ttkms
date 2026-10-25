"""Employee photos and the phone-capture tokens.

Files live under ``settings.media_dir / employees / <id>.jpg`` - outside the web root, served
only through the authenticated ``GET /api/payroll/employees/{id}/photo``. Uploads are JPEG, PNG
or WebP up to 5 MB; the server re-encodes to a JPEG whose longer side is at most 600 px.
"""

from __future__ import annotations

import base64
import re
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.models import Employee, User
from app.core.services import record_audit
from app.modules.payroll.models import PhotoToken

MAX_BYTES = 5 * 1024 * 1024
MAX_SIDE = 600
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
TOKEN_TTL = timedelta(minutes=15)
_DATA_URL = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


def invalid(detail: str, field: str = "image") -> HTTPException:
    from app.core.errors import ApiError

    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, "invalid", field=field)


def media_root() -> Path:
    return Path(settings.media_dir)


def photo_file(employee_id: int) -> Path:
    return media_root() / "employees" / f"{employee_id}.jpg"


def decode_data_url(value: str) -> bytes:
    match = _DATA_URL.match(value.strip())
    if not match or match.group(1).lower() not in ALLOWED_MEDIA_TYPES:
        raise invalid("Send a JPEG, PNG or WebP image.")
    payload = match.group(2)
    # 4/3 of the limit: refuse before decoding something huge.
    if len(payload) > MAX_BYTES * 4 // 3 + 4:
        raise invalid("The photo is larger than 5 MB.")
    try:
        return base64.b64decode(payload, validate=True)
    except ValueError:
        raise invalid("The photo data is not valid base64.") from None


def normalise(raw: bytes) -> bytes:
    """Validate and re-encode: JPEG/PNG/WebP in, upright JPEG <= 600 px out."""
    if len(raw) > MAX_BYTES:
        raise invalid("The photo is larger than 5 MB.")
    try:
        image = Image.open(BytesIO(raw))
        image_format = image.format
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise invalid("That file is not an image we can read (JPEG, PNG or WebP).") from None
    if image_format not in ALLOWED_FORMATS:
        raise invalid("Send a JPEG, PNG or WebP image.")
    image = ImageOps.exif_transpose(image) or image
    image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = BytesIO()
    image.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


async def store_photo(
    db: AsyncSession, actor: User | None, employee: Employee, raw: bytes
) -> Employee:
    data = normalise(raw)
    path = photo_file(employee.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    employee.photo_path = str(path.relative_to(media_root()))
    employee.updated_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        module="payroll",
        action="photo",
        entity="employee",
        entity_id=employee.id,
        user_id=actor.id if actor else None,
        data={"after": {"photo": employee.photo_path, "bytes": len(data)}},
    )
    await db.commit()
    await db.refresh(employee)
    return employee


async def remove_photo(db: AsyncSession, actor: User, employee: Employee) -> Employee:
    if employee.photo_path:
        path = media_root() / employee.photo_path
        if path.exists():
            path.unlink()
        employee.photo_path = None
        employee.updated_at = datetime.now(UTC)
        await db.flush()
        await record_audit(
            db,
            module="payroll",
            action="photo_removed",
            entity="employee",
            entity_id=employee.id,
            user_id=actor.id,
            data=None,
        )
        await db.commit()
        await db.refresh(employee)
    return employee


def photo_path_or_404(employee: Employee) -> Path:
    if not employee.photo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No photo.")
    path = media_root() / employee.photo_path
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No photo.")
    return path


# ------------------------------------------------------------------------------- tokens


async def create_token(
    db: AsyncSession, actor: User, employee: Employee, origin: str
) -> PhotoToken:
    token = PhotoToken(
        token=secrets.token_urlsafe(32),
        employee_id=employee.id,
        expires_at=datetime.now(UTC) + TOKEN_TTL,
        created_by=actor.id,
    )
    db.add(token)
    await db.commit()
    return token


def token_url(origin: str, token: str) -> str:
    return f"{origin.rstrip('/')}/people/photo/{token}"


async def live_token(db: AsyncSession, value: str) -> PhotoToken:
    """410 when unknown, used or expired - the phone shows "ask for a new QR code"."""
    token = await db.get(PhotoToken, value)
    if token is None or token.used_at is not None or token.expires_at <= datetime.now(UTC):
        raise HTTPException(
            status.HTTP_410_GONE, detail="This link has expired. Ask for a new QR code."
        )
    return token


async def use_token(db: AsyncSession, token: PhotoToken, raw: bytes) -> Employee:
    from app.modules.payroll.services import get_employee

    try:
        employee = await get_employee(db, token.employee_id)
    except HTTPException:
        raise HTTPException(
            status.HTTP_410_GONE, detail="This link has expired. Ask for a new QR code."
        ) from None
    token.used_at = datetime.now(UTC)
    await db.flush()
    return await store_photo(db, None, employee, raw)
