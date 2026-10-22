import pytest
from sqlalchemy import select

from app.config import settings
from app.core.auth import hash_password, is_safe_next, verify_password
from app.core.models import AuditLog, Role

pytestmark = pytest.mark.anyio

HTML = {"Accept": "text/html"}


def _session_cookie_headers(response) -> list[str]:
    return [
        h
        for h in response.headers.get_list("set-cookie")
        if h.startswith(settings.session_cookie + "=")
    ]


def test_password_hashing_roundtrip():
    digest = hash_password("correct horse")
    assert digest.startswith("$argon2")
    assert verify_password(digest, "correct horse")
    assert not verify_password(digest, "wrong")
    assert not verify_password("not-a-hash", "x")


def test_is_safe_next():
    assert is_safe_next("/stock")
    assert is_safe_next("/stock?page=2")
    assert not is_safe_next("//evil.example")
    assert not is_safe_next("https://evil.example")
    assert not is_safe_next("")
    assert not is_safe_next(None)
    assert not is_safe_next("/\\evil")


async def test_anonymous_is_redirected_to_login(client):
    response = await client.get("/")
    assert response.status_code == 303
    assert response.headers["location"] == "/login"

    response = await client.get("/stock?tab=items")
    assert response.status_code == 303
    assert response.headers["location"] == "/login?next=/stock?tab=items"


async def test_anonymous_htmx_request_gets_hx_redirect(client):
    response = await client.get("/", headers={"HX-Request": "true"})
    assert response.status_code == 401
    assert response.headers["HX-Redirect"] == "/login"


async def test_login_page_renders(client):
    response = await client.get("/login")
    assert response.status_code == 200
    assert 'name="csrf_token"' in response.text
    assert "Keep me signed in" in response.text
    assert 'class="login-page"' in response.text


async def test_login_wrong_password(client, make_user, login):
    await make_user("admin")
    page = await client.get("/login")
    from tests.conftest import csrf_token_from

    response = await client.post(
        "/login",
        data={"username": "admin", "password": "nope", "csrf_token": csrf_token_from(page.text)},
    )
    assert response.status_code == 401
    assert "Invalid username or password." in response.text


async def test_unknown_user_gets_same_error(client):
    page = await client.get("/login")
    from tests.conftest import csrf_token_from

    response = await client.post(
        "/login",
        data={"username": "ghost", "password": "x", "csrf_token": csrf_token_from(page.text)},
    )
    assert response.status_code == 401
    assert "Invalid username or password." in response.text


async def test_login_success_then_dashboard(client, make_user, login, db):
    user = await make_user("admin", full_name="Site Admin")
    response = await login("admin")
    assert response.headers["location"] == "/"
    cookies = _session_cookie_headers(response)
    assert len(cookies) == 1
    assert "Max-Age" not in cookies[0], "without 'keep me signed in' the cookie is a session cookie"
    assert "httponly" in cookies[0].lower()

    page = await client.get("/")
    assert page.status_code == 200
    assert "Site Admin" in page.text

    audit = (await db.execute(select(AuditLog).where(AuditLog.action == "login"))).scalars().all()
    assert len(audit) == 1 and audit[0].user_id == user.id
    await db.refresh(user)
    assert user.last_login_at is not None


async def test_keep_me_signed_in_sets_max_age(client, make_user, login):
    await make_user("admin")
    response = await login("admin", remember=True)
    cookies = _session_cookie_headers(response)
    assert f"Max-Age={settings.session_max_age_days * 86400}" in cookies[0]


async def test_username_is_normalised(client, make_user, login):
    await make_user("admin")
    response = await login("  ADMIN ")
    assert response.status_code == 303


async def test_inactive_user_cannot_log_in(client, make_user):
    await make_user("gone", is_active=False)
    page = await client.get("/login")
    from tests.conftest import csrf_token_from

    response = await client.post(
        "/login",
        data={
            "username": "gone",
            "password": "secret123",
            "csrf_token": csrf_token_from(page.text),
        },
    )
    assert response.status_code == 401


async def test_next_parameter_is_honoured_but_only_when_safe(client, make_user):
    await make_user("admin")
    page = await client.get("/login?next=//evil.example")
    assert 'name="next" value="/"' in page.text

    from tests.conftest import csrf_token_from

    token = csrf_token_from(page.text)
    response = await client.post(
        "/login",
        data={"username": "admin", "password": "secret123", "csrf_token": token, "next": "/stock"},
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/stock"


async def test_logout_clears_session(client, make_user, login, db):
    await make_user("admin")
    await login("admin")
    page = await client.get("/")
    from tests.conftest import csrf_token_from

    response = await client.post("/logout", data={"csrf_token": csrf_token_from(page.text)})
    assert response.status_code == 303
    assert response.headers["location"] == "/login"
    assert (await client.get("/")).status_code == 303
    actions = (await db.execute(select(AuditLog.action))).scalars().all()
    assert "logout" in actions


async def test_require_role_blocks_other_roles(client, make_user, login):
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    response = await client.get("/admin", headers=HTML)
    assert response.status_code == 403
    assert "You do not have access to this page" in response.text

    api_response = await client.get("/admin")  # non-HTML clients get JSON
    assert api_response.status_code == 403
    assert api_response.json()["detail"]

    assert (await client.get("/attendance")).status_code == 200


async def test_logged_in_user_visiting_login_is_redirected(client, make_user, login):
    await make_user("admin")
    await login("admin")
    response = await client.get("/login")
    assert response.status_code == 303
    assert response.headers["location"] == "/"
