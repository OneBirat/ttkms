"""Application settings (pydantic-settings).

Values come from the environment or from this repository's own ``.env`` file. The file is
resolved relative to this package, not the current working directory, so every git worktree
reads its own ``.env`` (own APP_PORT, same database).
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
STATIC_DIR = BASE_DIR / "static"
MEDIA_DIR = BASE_DIR / "media"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str
    secret_key: str
    app_port: int = 8000
    app_env: str = "dev"  # "dev" | "prod"

    # Session cookie (Starlette SessionMiddleware + itsdangerous)
    session_cookie: str = "ttk_session"
    session_max_age_days: int = 14  # cookie lifetime when "Keep me signed in" is ticked
    session_https_only: bool = False  # the app may run on a LAN over plain HTTP

    # Used by `python -m app.cli seed` / `create-admin` when set; otherwise the CLI prompts.
    admin_username: str | None = None
    admin_password: str | None = None

    # The test-suite creates and migrates this database itself.
    # Defaults to "<database>_test" on the same server.
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

        url = make_url(self.database_url)
        return url.set(database=f"{url.database}_test").render_as_string(hide_password=False)


settings = Settings()
