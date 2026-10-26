"""Employee photos: upload (JSON data URL and multipart) into a 600 px JPEG + 128 px WebP with no
metadata, versioned cacheable URLs, signed-in users only, limits, removal, phone tokens, the
legacy-layout upgrade."""

import base64
from datetime import UTC, date, datetime, timedelta
from io import BytesIO

import pytest
from PIL import Image

from app.config import settings
from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.admin.models import UserAccess
from app.modules.payroll import photos
from app.modules.payroll.models import PhotoToken

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_dir", tmp_path / "media")
    return tmp_path / "media"


def png(width=1200, height=800, color=(200, 30, 30)) -> bytes:
    out = BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="PNG")
    return out.getvalue()


def data_url(raw: bytes, media_type="image/png") -> str:
    return f"data:{media_type};base64,{base64.b64encode(raw).decode()}"


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _setup(db):
    main, second = Branch(name="Main branch"), Branch(name="Branch 2")
    store = Department(name="Store")
    db.add_all([main, second, store])
    await db.flush()
    anita = Employee(full_name="Anita", branch_id=main.id, department_id=store.id)
    mina = Employee(full_name="Mina", branch_id=second.id, department_id=store.id)
    db.add_all([anita, mina])
    await db.flush()
    return main, second, anita, mina


async def _admin(client, make_user, login):
    await make_user("admin", role="admin")
    await login("admin")
    return {"X-CSRF-Token": await _csrf(client)}


def _stored(media_dir, url: str):
    """(JPEG, WebP) files behind a photo URL's version."""
    version = url.rsplit("v=", 1)[1]
    employee_id = url.split("/employees/")[1].split("/")[0]
    folder = media_dir / "employees" / employee_id
    return folder / f"{version}.jpg", folder / f"{version}.thumb.webp"


async def test_upload_resize_serve_and_remove(client, db, make_user, login, media_dir):
    main, second, anita, mina = await _setup(db)
    headers = await _admin(client, make_user, login)
    assert (await client.get(f"/api/payroll/employees/{anita.id}/photo")).status_code == 404
    put = await client.put(
        f"/api/payroll/employees/{anita.id}/photo",
        json={"photo_data_url": data_url(png())},
        headers=headers,
    )
    assert put.status_code == 200, put.text
    url, thumb_url = put.json()["photo_url"], put.json()["photo_thumb_url"]
    base = f"/api/payroll/employees/{anita.id}/photo"
    assert url.startswith(f"{base}?size=full&v=") and thumb_url.startswith(f"{base}?size=thumb&v=")
    assert url.rsplit("v=", 1)[1] == thumb_url.rsplit("v=", 1)[1]
    full, thumb = _stored(media_dir, url)
    image = Image.open(full)
    assert image.format == "JPEG" and image.size == (600, 400)
    small = Image.open(thumb)
    assert small.format == "WEBP" and small.size == (128, 85)
    served = await client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert served.content[:3] == b"\xff\xd8\xff"
    small_served = await client.get(thumb_url)
    assert small_served.status_code == 200 and small_served.headers["content-type"] == "image/webp"
    assert small_served.content[8:12] == b"WEBP"
    # Multipart replaces it: new files, new version, the old ones are gone.
    files = {"image": ("new.png", png(300, 900, (30, 30, 200)), "image/png")}
    replaced = await client.put(
        f"/api/payroll/employees/{anita.id}/photo", files=files, headers=headers
    )
    assert replaced.status_code == 200, replaced.text
    new_url = replaced.json()["photo_url"]
    assert new_url != url and not full.exists() and not thumb.exists()
    new_full, new_thumb = _stored(media_dir, new_url)
    assert Image.open(new_full).size == (200, 600) and Image.open(new_thumb).size == (43, 128)
    removed = await client.delete(f"/api/payroll/employees/{anita.id}/photo", headers=headers)
    assert removed.status_code == 200 and removed.json()["photo_url"] is None
    assert removed.json()["photo_thumb_url"] is None
    assert not new_full.exists() and not new_thumb.exists()
    assert (await client.get(f"/api/payroll/employees/{anita.id}/photo")).status_code == 404
    listed = (await client.get("/api/payroll/employees")).json()
    assert all(r["employee"]["photo_url"] is None for r in listed)


def jpeg_with_exif() -> bytes:
    """A JPEG carrying camera EXIF, a GPS location and orientation 6 (rotate 90°)."""
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0110] = "Phone X"  # Model
    exif[0x0112] = 6  # Orientation
    exif[0x8825] = {1: "N", 2: (27.0, 42.0, 30.0), 3: "E", 4: (85.0, 19.0, 12.0)}  # GPSInfo
    out = BytesIO()
    Image.new("RGB", (800, 400), (10, 120, 60)).save(out, format="JPEG", exif=exif.tobytes())
    raw = out.getvalue()
    assert Image.open(BytesIO(raw)).getexif().get_ifd(0x8825)
    return raw


async def test_exif_and_location_are_stripped(client, db, make_user, login, media_dir):
    main, second, anita, mina = await _setup(db)
    headers = await _admin(client, make_user, login)
    files = {"image": ("camera.jpg", jpeg_with_exif(), "image/jpeg")}
    put = await client.put(f"/api/payroll/employees/{anita.id}/photo", files=files, headers=headers)
    assert put.status_code == 200, put.text
    for path in _stored(media_dir, put.json()["photo_url"]):
        data = path.read_bytes()
        image = Image.open(path)
        assert len(image.getexif()) == 0, path.name
        assert b"Exif" not in data and b"PhoneMaker" not in data and b"GPS" not in data
        assert "exif" not in image.info and "icc_profile" not in image.info
    # Orientation was applied to the pixels before the tag was dropped: portrait now.
    full, thumb = _stored(media_dir, put.json()["photo_url"])
    assert Image.open(full).size == (300, 600) and Image.open(thumb).size == (64, 128)
    # JPEG quality 80: the same quantization tables as any image Pillow saves at 80.
    reference = BytesIO()
    Image.new("RGB", (8, 8)).save(reference, format="JPEG", quality=80)
    assert Image.open(full).quantization == Image.open(reference).quantization


async def test_cache_headers_follow_the_version(client, db, make_user, login, media_dir):
    main, second, anita, mina = await _setup(db)
    headers = await _admin(client, make_user, login)
    put = await client.put(
        f"/api/payroll/employees/{anita.id}/photo",
        json={"photo_data_url": data_url(png())},
        headers=headers,
    )
    for url in (put.json()["photo_url"], put.json()["photo_thumb_url"]):
        served = await client.get(url)
        assert served.status_code == 200
        assert served.headers["cache-control"] == "private, max-age=31536000, immutable"
    # No version, or one from an older photo: the browser must revalidate.
    base = f"/api/payroll/employees/{anita.id}/photo"
    for url in (base, f"{base}?size=thumb", f"{base}?size=thumb&v=0123456789abcdef"):
        served = await client.get(url)
        assert served.status_code == 200
        assert served.headers["cache-control"] == "private, no-cache"
    assert (await client.get(f"{base}?size=huge")).status_code == 422


async def test_photos_need_a_session_and_attendance_users_may_see_them(
    client, db, make_user, login, media_dir
):
    main, second, anita, mina = await _setup(db)
    anita.joined_ad = date(2026, 1, 1)  # on the day list whatever the frozen test "today" is
    await db.flush()
    headers = await _admin(client, make_user, login)
    put = await client.put(
        f"/api/payroll/employees/{anita.id}/photo",
        json={"photo_data_url": data_url(png())},
        headers=headers,
    )
    urls = [put.json()["photo_url"], put.json()["photo_thumb_url"]]
    await client.post("/api/auth/logout", headers=headers)
    for url in urls:
        response = await client.get(url)
        assert response.status_code == 401
        assert "max-age" not in response.headers.get("cache-control", "")
    # A mark-attendance-only user of the branch sees the thumbnail on the attendance cards.
    clerk = await make_user("clerk", role="manager")
    db.add(
        UserAccess(
            user_id=clerk.id,
            branch_id=main.id,
            access={
                "mark_attendance": True,
                "view_attendance_report": False,
                "manage_employees": False,
                "salary_advances": False,
            },
        )
    )
    await db.flush()
    await login("clerk")
    assert (await client.get(urls[1])).status_code == 200
    day = await client.get("/api/attendance/day", params={"date_bs": bsdate.today_bs().isoformat()})
    assert day.status_code == 200, day.text
    row = next(r for r in day.json()["rows"] if r["employee"]["id"] == anita.id)
    assert row["employee"]["photo_url"] == urls[1]


async def test_legacy_photos_are_served_and_upgraded(db, media_dir):
    main, second, anita, mina = await _setup(db)
    legacy = media_dir / "employees" / f"{anita.id}.jpg"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(jpeg_with_exif())
    anita.photo_path = f"employees/{anita.id}.jpg"
    await db.flush()
    path, media_type = photos.photo_file_or_404(anita, "thumb")
    assert path == legacy and media_type == "image/jpeg"
    assert await photos.upgrade_legacy(db) == 1
    assert not legacy.exists()
    full, thumb = photos.media_root() / anita.photo_path, None
    thumb = photos.thumb_of(full)
    assert full.is_file() and thumb.is_file() and len(Image.open(full).getexif()) == 0
    assert await photos.upgrade_legacy(db) == 0


async def test_upload_limits(client, db, make_user, login):
    main, second, anita, mina = await _setup(db)
    headers = await _admin(client, make_user, login)
    not_image = await client.put(
        f"/api/payroll/employees/{anita.id}/photo",
        json={"photo_data_url": data_url(b"hello world " * 10, "image/png")},
        headers=headers,
    )
    assert not_image.status_code == 422 and not_image.json()["field"] == "image"
    wrong_type = await client.put(
        f"/api/payroll/employees/{anita.id}/photo",
        json={"photo_data_url": data_url(png(), "image/gif")},
        headers=headers,
    )
    assert wrong_type.status_code == 422
    files = {"image": ("big.bin", b"\0" * (5 * 1024 * 1024 + 1), "image/png")}
    too_big = await client.put(
        f"/api/payroll/employees/{anita.id}/photo", files=files, headers=headers
    )
    assert too_big.status_code == 422 and "5 MB" in too_big.json()["detail"]
    bad_json = await client.put(
        f"/api/payroll/employees/{anita.id}/photo", json={"nope": 1}, headers=headers
    )
    assert bad_json.status_code == 422
    # A manager of another branch cannot touch this photo; staff cannot at all.
    await client.post("/api/auth/logout", headers=headers)
    boss = await make_user("boss", role="manager")
    db.add(UserAccess(user_id=boss.id, branch_id=second.id, access=None))
    await db.flush()
    await login("boss")
    headers = {"X-CSRF-Token": await _csrf(client)}
    assert (
        await client.put(
            f"/api/payroll/employees/{anita.id}/photo",
            json={"photo_data_url": data_url(png())},
            headers=headers,
        )
    ).status_code == 403
    assert (
        await client.post(
            "/api/payroll/photo-tokens", json={"employee_id": anita.id}, headers=headers
        )
    ).status_code == 403
    assert (
        await client.post(
            "/api/payroll/photo-tokens",
            json={"employee_id": mina.id, "origin": "http://phone.test"},
            headers=headers,
        )
    ).status_code == 201


async def test_phone_tokens_are_single_use_and_expire(client, db, make_user, login, media_dir):
    main, second, anita, mina = await _setup(db)
    headers = await _admin(client, make_user, login)
    created = await client.post(
        "/api/payroll/photo-tokens",
        json={"employee_id": anita.id, "origin": "http://localhost:3000"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    token = body["token"]
    assert (
        body["url"] == f"http://localhost:3000/people/photo/{token}"
        and body["employee_id"] == anita.id
    )
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(minutes=14) < expires - datetime.now(UTC) <= timedelta(minutes=15)
    # The phone has no session: it reads the token and uploads with only a CSRF token.
    await client.post("/api/auth/logout", headers=headers)
    info = await client.get(f"/api/payroll/photo-tokens/{token}")
    assert info.status_code == 200 and info.json()["employee"]["full_name"] == "Anita"
    anon = {"X-CSRF-Token": await _csrf(client)}
    upload = await client.post(
        f"/api/payroll/photo-tokens/{token}/photo",
        json={"photo_data_url": data_url(png())},
        headers=anon,
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["photo_url"] is not None
    assert all(p.is_file() for p in _stored(media_dir, upload.json()["photo_url"]))
    # Single use: the token is gone afterwards.
    assert (await client.get(f"/api/payroll/photo-tokens/{token}")).status_code == 410
    again = await client.post(
        f"/api/payroll/photo-tokens/{token}/photo",
        json={"photo_data_url": data_url(png())},
        headers=anon,
    )
    assert again.status_code == 410
    assert (await client.get("/api/payroll/photo-tokens/nope")).status_code == 410
    # Expired tokens answer 410 too.
    expired = PhotoToken(
        token="expired-token",
        employee_id=anita.id,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    db.add(expired)
    await db.flush()
    assert (await client.get("/api/payroll/photo-tokens/expired-token")).status_code == 410
    # The photo itself still needs a session.
    assert (await client.get(f"/api/payroll/employees/{anita.id}/photo")).status_code == 401
