import pytest

from tests.conftest import csrf_token_from

pytestmark = pytest.mark.anyio


async def test_post_without_token_is_rejected(client):
    await client.get("/login")  # establishes a session
    response = await client.post("/login", data={"username": "a", "password": "b"})
    assert response.status_code == 403
    assert "CSRF" in response.json()["detail"]


async def test_post_with_wrong_token_is_rejected(client):
    await client.get("/login")
    response = await client.post(
        "/login", data={"username": "a", "password": "b", "csrf_token": "forged"}
    )
    assert response.status_code == 403


async def test_post_without_any_session_is_rejected(client):
    response = await client.post(
        "/login", data={"username": "a", "password": "b", "csrf_token": "whatever"}
    )
    assert response.status_code == 403


async def test_header_token_is_accepted_for_htmx(client, make_user, login):
    await make_user("admin")
    await login("admin")
    page = await client.get("/")
    token = csrf_token_from(page.text)
    assert f'hx-headers=\'{{"X-CSRF-Token": "{token}"}}\'' in page.text
    response = await client.post("/logout", headers={"X-CSRF-Token": token})
    assert response.status_code == 303


async def test_token_rotates_at_login(client, make_user, login):
    await make_user("admin")
    before = csrf_token_from((await client.get("/login")).text)
    await login("admin")
    after = csrf_token_from((await client.get("/")).text)
    assert before != after
