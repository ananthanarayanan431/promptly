from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class ClerkSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    CLERK_SECRET_KEY: SecretStr
    CLERK_WEBHOOK_SECRET: SecretStr
    CLERK_AUTHORIZED_PARTY: str = "http://localhost:3000"


@lru_cache
def get_clerk_settings() -> ClerkSettings:
    return ClerkSettings()
