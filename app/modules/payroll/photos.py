"""Employee photos and the phone-capture tokens.

Uploads are JPEG, PNG or WebP up to 5 MB. Each is re-encoded, upright and with every bit of
metadata dropped (EXIF, GPS location, XMP, ICC), into two files under
``settings.media_dir / employees / <id> /``:

- ``<hash>.jpg``        the longer side at most 600 px, JPEG quality 80 (profile, barcode views)
- ``<hash>.thumb.webp`` the longer side at most 128 px, WebP (lists, side strip, avatars, cards)

``<hash>`` is the start of the JPEG's SHA-256, so a new photo gets new names and a new ``v=`` in
its URLs (``GET /api/payroll/employees/{id}/photo?size=full|thumb&v=<hash>``), which browsers
may then cache for a year. The files stay outside the web root and are only served to signed-in
users through that endpoint. ``employees.photo_path`` points at the JPEG. Photos stored before
this layout (``employees/<id>.jpg``) are still served; ``python -m app.cli photos-upgrade``
converts them.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.media import is_legacy
from app.core.models import Employee, User
from app.core.services import record_audit
from app.modules.payroll.models import PhotoToken

MAX_BYTES = 5 * 1024 * 1024
MAX_SIDE = 600
JPEG_QUALITY = 80
THUMB_SIDE = 128
THUMB_QUALITY = 80
SIZES = ("full", "thumb")
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
TOKEN_TTL = timedelta(minutes=15)
_DATA_URL = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


def invalid(detail: str, field: str = "image") -> HTTPException:
    from app.core.errors import ApiError

    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, "invalid", field=field)


def media_root() -> Path:
    return Path(settings.media_dir)


def photo_dir(employee_id: int) -> Path:
    return media_root() / "employees" / str(employee_id)


def thumb_of(path: Path) -> Path:
    """``<hash>.jpg`` -> ``<hash>.thumb.webp`` (legacy ``<id>.jpg`` has no thumbnail)."""
    return path.with_name(f"{path.stem}.thumb.webp")


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


def _clean(image: Image.Image) -> Image.Image:
    """Upright RGB pixels only: a fresh image carries no EXIF / GPS / XMP / ICC from the upload."""
    image = ImageOps.exif_transpose(image) or image
    image = image.convert("RGB")
    clean = Image.new("RGB", image.size)
    clean.paste(image)
    return clean


def normalise(raw: bytes) -> tuple[bytes, bytes]:
    """Validate and re-encode: JPEG/PNG/WebP in; (600 px JPEG q80, 128 px WebP) out, no metadata."""
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
    image = _clean(image)
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    full = BytesIO()
    image.save(full, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    thumb_image = image.copy()
    thumb_image.thumbnail((THUMB_SIDE, THUMB_SIDE))
    thumb = BytesIO()
    thumb_image.save(thumb, format="WEBP", quality=THUMB_QUALITY, method=6)
    return full.getvalue(), thumb.getvalue()


def _write(employee_id: int, full: bytes, thumb: bytes) -> Path:
    """Both files under employees/<id>/, named by the JPEG's hash; returns the JPEG path."""
    folder = photo_dir(employee_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{hashlib.sha256(full).hexdigest()[:16]}.jpg"
    for target, data in ((path, full), (thumb_of(path), thumb)):
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(target)
    return path


def _remove_files(photo_path: str | None, keep: Path | None = None) -> None:
    """Delete a stored photo (both sizes), unless it is ``keep`` (same content uploaded again)."""
    if not photo_path:
        return
    path = media_root() / photo_path
    if keep is not None and path == keep:
        return
    for target in (path, thumb_of(path)):
        target.unlink(missing_ok=True)


async def store_photo(
    db: AsyncSession, actor: User | None, employee: Employee, raw: bytes
) -> Employee:
    full, thumb = normalise(raw)
    path = _write(employee.id, full, thumb)
    previous = employee.photo_path
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
        data={"after": {"photo": employee.photo_path, "bytes": len(full), "thumb": len(thumb)}},
    )
    await db.commit()
    _remove_files(previous, keep=path)
    await db.refresh(employee)
    return employee


async def remove_photo(db: AsyncSession, actor: User, employee: Employee) -> Employee:
    if employee.photo_path:
        previous = employee.photo_path
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
        _remove_files(previous)
        await db.refresh(employee)
    return employee


def photo_file_or_404(employee: Employee, size: str) -> tuple[Path, str]:
    """(file, media type) of one size; a legacy photo serves its JPEG for both sizes."""
    if not employee.photo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No photo.")
    path = media_root() / employee.photo_path
    if size == "thumb" and not is_legacy(employee.photo_path):
        thumb = thumb_of(path)
        if thumb.is_file():
            return thumb, "image/webp"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No photo.")
    return path, "image/jpeg"


async def upgrade_legacy(db: AsyncSession) -> int:
    """Re-store every ``employees/<id>.jpg`` photo in the two-size layout (metadata stripped);
    returns how many were converted. Safe to run again."""
    from sqlalchemy import select

    rows = await db.scalars(select(Employee).where(Employee.photo_path.is_not(None)))
    done = 0
    for employee in list(rows):
        if not is_legacy(employee.photo_path):
            continue
        old = media_root() / employee.photo_path
        if not old.is_file():
            continue
        full, thumb = normalise(old.read_bytes())
        path = _write(employee.id, full, thumb)
        employee.photo_path = str(path.relative_to(media_root()))
        await db.commit()
        old.unlink(missing_ok=True)
        done += 1
    return done


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
