"""Application settings (pydantic-settings).

Values come from the environment or from this repository's own ``.env`` file. The file is
resolved relative to this package, not the current working directory, so every git worktree
reads its own ``.env`` (own APP_PORT, same database).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
STATIC_DIR = BASE_DIR / "static"
MEDIA_DIR = BASE_DIR / "media"

PLACEHOLDER_SECRETS = frozenset({"CHANGE_ME", "change-me", "change-me-dev-only", "secret", ""})
log = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str
    secret_key: str
    app_port: int = 8000
    app_env: Literal["dev", "prod"] = "dev"

    # Session cookie (Starlette SessionMiddleware + itsdangerous)
    session_cookie: str = "ttk_session"
    session_max_age_days: int = 14  # cookie lifetime when "Keep me signed in" is ticked
    session_short_max_age_hours: int = 12  # server-side lifetime of a plain (browser) session
    session_https_only: bool = False  # the app may run on a LAN over plain HTTP

    # Used by `python -m app.cli seed` / `create-admin` when set; otherwise the CLI prompts.
    admin_username: str | None = None
    admin_password: str | None = None

    # The test-suite creates and migrates this database itself.
    # Defaults to "<database>_test_<checkout dir>" on the same server.
    test_database_url: str | None = None

    timezone: str = "Asia/Kathmandu"

    @property
    def is_prod(self) -> bool:
        return self.app_env == "prod"

    @property
    def resolved_test_database_url(self) -> str:
        if self.test_database_url:
            return self.test_database_url
        from sqlalchemy.engine import make_url

        # One test database per checkout, so worktrees running `make test` at the same time
        # never reset each other's schemas: ttk_test_ttkms, ttk_test_ttk_stock, ...
        suffix = re.sub(r"[^a-z0-9_]+", "_", BASE_DIR.name.lower()).strip("_")
        url = make_url(self.database_url)
        return url.set(database=f"{url.database}_test_{suffix}").render_as_string(
            hide_password=False
        )

    @field_validator("app_env", mode="before")
    @classmethod
    def _normalise_env(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _check_secret_key(self) -> Settings:
        weak = self.secret_key in PLACEHOLDER_SECRETS or len(self.secret_key) < 32
        if weak and self.is_prod:
            raise ValueError(
                "SECRET_KEY is a placeholder or too short for APP_ENV=prod; generate one with "
                "python -c 'import secrets; print(secrets.token_urlsafe(48))'"
            )
        if weak:
            log.warning("SECRET_KEY is weak - fine for local development, never for production")
        return self


settings = Settings()
