"""Employee photos: upload (JSON data URL and multipart), limits, serving, removal, phone tokens."""

import base64
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from PIL import Image

from app.config import settings
from app.core.models import Branch, Department, Employee
from app.modules.admin.models import UserAccess
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
    url = put.json()["photo_url"]
    assert url.startswith(f"/api/payroll/employees/{anita.id}/photo?v=")
    stored = media_dir / "employees" / f"{anita.id}.jpg"
    assert stored.is_file()
    image = Image.open(stored)
    assert image.format == "JPEG" and max(image.size) == 600 and image.size == (600, 400)
    served = await client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert served.content[:3] == b"\xff\xd8\xff"
    # Multipart replaces it; the version in the URL changes.
    files = {"image": ("new.png", png(300, 900, (30, 30, 200)), "image/png")}
    replaced = await client.put(
        f"/api/payroll/employees/{anita.id}/photo", files=files, headers=headers
    )
    assert replaced.status_code == 200, replaced.text
    assert Image.open(stored).size == (200, 600)
    removed = await client.delete(f"/api/payroll/employees/{anita.id}/photo", headers=headers)
    assert removed.status_code == 200 and removed.json()["photo_url"] is None
    assert not stored.exists()
    assert (await client.get(f"/api/payroll/employees/{anita.id}/photo")).status_code == 404
    listed = (await client.get("/api/payroll/employees")).json()
    assert all(r["employee"]["photo_url"] is None for r in listed)


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
    assert (
        upload.json()["photo_url"] is not None
        and (media_dir / "employees" / f"{anita.id}.jpg").is_file()
    )
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
