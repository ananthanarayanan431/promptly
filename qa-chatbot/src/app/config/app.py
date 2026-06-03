from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    APP_VERSION: str = "0.1.0"  # overridable via APP_VERSION env (e.g. build SHA)
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    PRODUCTION_APPLICATION: bool = False
    API_V1_PREFIX: str = "/api/v1"
    # Allowed CORS origins. NEVER include "*" — set explicit origins per environment.
    # Production sets this via the CORS_ORIGIN env var (JSON list).
    CORS_ORIGIN: list[str] = ["http://localhost:3000"]
    MAX_REQUEST_BODY_BYTES: int = 100 * 1024 * 1024  # 100 MB (PDF uploads)
    REQUEST_TIMEOUT_SECONDS: float = 60.0
    SENTRY_DSN: SecretStr | None = None


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
