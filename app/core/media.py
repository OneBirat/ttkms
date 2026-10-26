"""Employee photo URLs (core.employees.photo_path); the files and the endpoint belong to payroll
(app/modules/payroll/photos.py). Every URL carries the photo's version so it can be cached for a
year: a new photo means a new version."""

from __future__ import annotations

import re
from pathlib import PurePosixPath

from app.core.models import Employee


def is_legacy(photo_path: str) -> bool:
    """``employees/<id>.jpg``, stored before the ``employees/<id>/<hash>.jpg`` layout."""
    return photo_path.count("/") == 1


def photo_version(employee: Employee) -> str | None:
    """The ``v=`` of the photo URLs: the content hash (legacy photos: from ``updated_at``)."""
    if not employee.photo_path:
        return None
    if not is_legacy(employee.photo_path):
        return PurePosixPath(employee.photo_path).stem
    stamp = employee.updated_at.isoformat() if employee.updated_at else "0"
    return "l" + re.sub(r"\D", "", stamp)[-10:]


def photo_urls(employee: Employee) -> tuple[str | None, str | None]:
    """(600 px URL, 128 px thumbnail URL), or (None, None) without a photo."""
    version = photo_version(employee)
    if version is None:
        return None, None
    base = f"/api/payroll/employees/{employee.id}/photo"
    return f"{base}?size=full&v={version}", f"{base}?size=thumb&v={version}"
