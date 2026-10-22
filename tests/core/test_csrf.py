import pytest

pytestmark = pytest.mark.anyio

LOGIN = {"username": "a", "password": "b"}


async def test_post_without_token_is_rejected(client):
    await client.get("/api/auth/csrf")  # establishes a session
    response = await client.post("/api/auth/login", json=LOGIN)
    assert response.status_code == 403
    assert "CSRF" in response.json()["detail"]


async def test_post_with_wrong_token_is_rejected(client):
    await client.get("/api/auth/csrf")
    response = await client.post("/api/auth/login", json=LOGIN, headers={"X-CSRF-Token": "forged"})
    assert response.status_code == 403


async def test_post_without_any_session_is_rejected(client):
    response = await client.post(
        "/api/auth/login", json=LOGIN, headers={"X-CSRF-Token": "whatever"}
    )
    assert response.status_code == 403


async def test_form_field_fallback_is_accepted(client, make_user, login):
    await make_user("admin")
    token = (await login("admin")).json()["csrf_token"]
    response = await client.post("/api/auth/logout", data={"csrf_token": token})
    assert response.status_code == 204


async def test_token_rotates_at_login_and_is_reported_by_me(client, make_user, login):
    await make_user("admin")
    before = (await client.get("/api/auth/csrf")).json()["csrf_token"]
    after = (await login("admin")).json()["csrf_token"]
    assert before != after
    assert (await client.get("/api/auth/me")).json()["csrf_token"] == after
