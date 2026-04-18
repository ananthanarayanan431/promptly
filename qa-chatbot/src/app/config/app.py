from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGIN: list[str] = ["http://localhost:3000", "*"]
    MAX_REQUEST_BODY_BYTES: int = 1 * 1024 * 1024  # 1 MB
    REQUEST_TIMEOUT_SECONDS: float = 60.0


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
