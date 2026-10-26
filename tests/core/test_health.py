import pytest

pytestmark = pytest.mark.anyio


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_api_health_checks_the_database(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_api_health_is_503_without_the_database(client, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession

    async def broken(self, *args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(AsyncSession, "execute", broken)
    response = await client.get("/api/health")
    assert response.status_code == 503 and response.json()["database"] == "unreachable"


def test_session_cookie_is_secure_in_production(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "session_https_only", None)
    monkeypatch.setattr(settings, "app_env", "prod")
    assert settings.session_secure
    monkeypatch.setattr(settings, "app_env", "dev")
    assert not settings.session_secure
    monkeypatch.setattr(settings, "session_https_only", True)
    assert settings.session_secure
