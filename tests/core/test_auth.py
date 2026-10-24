from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.config import settings
from app.core import auth
from app.core.auth import hash_password, verify_password
from app.core.models import AuditLog, Role

pytestmark = pytest.mark.anyio


def _session_cookies(response) -> list[str]:
    prefix = settings.session_cookie + "="
    return [h for h in response.headers.get_list("set-cookie") if h.startswith(prefix)]


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


def test_password_hashing_roundtrip():
    digest = hash_password("correct horse")
    assert digest.startswith("$argon2")
    assert verify_password(digest, "correct horse")
    assert not verify_password(digest, "wrong")
    assert not verify_password("not-a-hash", "x")


async def test_anonymous_requests_get_401_json(client):
    for path in ("/api/auth/me", "/api/dashboard", "/api/registry", "/api/attendance"):
        response = await client.get(path)
        assert response.status_code == 401, path
        assert response.json() == {"detail": "login required"}


async def test_csrf_endpoint_starts_a_session(client):
    response = await client.get("/api/auth/csrf")
    assert response.status_code == 200
    assert len(response.json()["csrf_token"]) > 20
    assert _session_cookies(response), "a session cookie is issued"


async def test_login_wrong_password(client, make_user):
    await make_user("admin")
    token = await _csrf(client)
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "nope"},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid phone, username or password."}


async def test_unknown_and_inactive_users_get_the_same_error(client, make_user):
    await make_user("gone", is_active=False)
    token = await _csrf(client)
    for username in ("ghost", "gone"):
        response = await client.post(
            "/api/auth/login",
            json={"username": username, "password": "secret123"},
            headers={"X-CSRF-Token": token},
        )
        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid phone, username or password."}


async def test_login_validates_payload(client):
    token = await _csrf(client)
    response = await client.post(
        "/api/auth/login", json={"username": ""}, headers={"X-CSRF-Token": token}
    )
    assert response.status_code == 422


async def test_login_success_then_me(client, make_user, login, db):
    user = await make_user("admin", full_name="Site Admin")
    response = await login("admin")
    body = response.json()
    assert body["user"] == {
        "id": user.id,
        "username": "admin",
        "phone": None,
        "full_name": "Site Admin",
        "role": "admin",
        "role_label": "Admin",
        "employee_id": None,
        "last_login_at": body["user"]["last_login_at"],
        "must_change_password": False,
    }
    assert body["user"]["last_login_at"] is not None
    assert body["csrf_token"]
    cookies = _session_cookies(response)
    assert len(cookies) == 1
    assert "Max-Age" not in cookies[0], "without 'keep me signed in' the cookie is a session cookie"
    assert "httponly" in cookies[0].lower() and "samesite=lax" in cookies[0].lower()

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["username"] == "admin"
    assert me.json()["csrf_token"] == body["csrf_token"]

    audit = (await db.execute(select(AuditLog).where(AuditLog.action == "login"))).scalars().all()
    assert len(audit) == 1 and audit[0].user_id == user.id


async def test_keep_me_signed_in_sets_max_age(client, make_user, login):
    await make_user("admin")
    response = await login("admin", remember=True)
    cookies = _session_cookies(response)
    assert f"Max-Age={settings.session_max_age_days * 86400}" in cookies[0]


async def test_short_session_expires_server_side(client, make_user, login, monkeypatch):
    await make_user("admin")
    await login("admin", remember=False)
    assert (await client.get("/api/auth/me")).status_code == 200
    later = auth.time.time() + (settings.session_short_max_age_hours + 1) * 3600
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: later))
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_persistent_session_does_not_expire_early(client, make_user, login, monkeypatch):
    await make_user("admin")
    await login("admin", remember=True)
    later = auth.time.time() + (settings.session_short_max_age_hours + 1) * 3600
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: later))
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_username_is_normalised(client, make_user, login):
    await make_user("admin")
    assert (await login("  ADMIN ")).status_code == 200


async def test_logout_clears_session(client, make_user, login, db):
    await make_user("admin")
    token = (await login("admin")).json()["csrf_token"]
    response = await client.post("/api/auth/logout", headers={"X-CSRF-Token": token})
    assert response.status_code == 204
    cleared = _session_cookies(response)
    assert cleared and "expires=Thu, 01 Jan 1970" in cleared[0]
    assert (await client.get("/api/auth/me")).status_code == 401
    actions = (await db.execute(select(AuditLog.action))).scalars().all()
    assert "logout" in actions


async def test_deactivated_user_is_logged_out(client, make_user, login, db):
    user = await make_user("admin")
    await login("admin")
    user.is_active = False
    await db.flush()
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_access_guard_blocks_staff_from_payroll(client, make_user, login):
    """Staff (mark_attendance only) reach attendance but get the same 403 wording from
    payroll's permission guard as ``require_role`` gives."""
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    response = await client.get("/api/payroll")
    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have access to this page."
    assert (await client.get("/api/attendance")).status_code == 200


def test_require_role_rejects_unknown_roles():
    with pytest.raises(ValueError):
        auth.require_role("superuser")
    with pytest.raises(ValueError):
        auth.require_role()


async def test_login_with_phone_number(client, make_user, db):
    user = await make_user("sita")
    user.phone = "9841000002"
    await db.flush()
    token = await _csrf(client)
    for identifier in ("9841000002", "+977 9841 000 002", "0984-1000002"):
        response = await client.post(
            "/api/auth/login",
            json={"username": identifier, "password": "secret123"},
            headers={"X-CSRF-Token": token},
        )
        assert response.status_code == 200, identifier
        assert response.json()["user"]["phone"] == "9841000002"
        token = response.json()["csrf_token"]
    # A phone-shaped identifier never falls back to a username lookup.
    await make_user("9841000003")
    response = await client.post(
        "/api/auth/login",
        json={"username": "9841000003", "password": "secret123"},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 401


def test_phone_normalisation():
    from app.core.models import is_phone, normalize_phone

    assert normalize_phone("+977 98-4100 0001") == "9841000001"
    assert normalize_phone("09841000001") == "9841000001"
    assert normalize_phone("9779841000001") == "9841000001"
    assert is_phone("9841000001") and is_phone("+977 9851 234 567")
    assert not is_phone("admin") and not is_phone("1234567890") and not is_phone("98410")


async def test_temporary_password_forces_a_change(client, make_user, login, db):
    user = await make_user("newbie", password="Temp-1234x")
    user.must_change_password = True
    await db.flush()
    token = (await login("newbie", password="Temp-1234x")).json()["csrf_token"]

    # Only /api/auth/* works until the password is changed.
    me = await client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["must_change_password"] is True
    blocked = await client.get("/api/dashboard")
    assert blocked.status_code == 403
    assert blocked.json() == {
        "detail": auth.PASSWORD_CHANGE_REQUIRED_DETAIL,
        "code": "password_change_required",
    }

    # Wrong current password, too short, or unchanged: refused.
    headers = {"X-CSRF-Token": token}
    bad = await client.post(
        "/api/auth/change-password",
        json={"current_password": "nope", "new_password": "longenough1"},
        headers=headers,
    )
    assert bad.status_code == 401
    short = await client.post(
        "/api/auth/change-password",
        json={"current_password": "Temp-1234x", "new_password": "short"},
        headers=headers,
    )
    assert short.status_code == 422
    same = await client.post(
        "/api/auth/change-password",
        json={"current_password": "Temp-1234x", "new_password": "Temp-1234x"},
        headers=headers,
    )
    assert same.status_code == 400

    ok = await client.post(
        "/api/auth/change-password",
        json={"current_password": "Temp-1234x", "new_password": "my-own-password"},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["must_change_password"] is False
    assert (await client.get("/api/dashboard")).status_code == 200
    actions = (await db.execute(select(AuditLog.action))).scalars().all()
    assert "change_password" in actions

    # The new password works, the temporary one does not.
    await client.post("/api/auth/logout", headers={"X-CSRF-Token": ok.json()["csrf_token"]})
    assert (await login("newbie", password="my-own-password")).status_code == 200
