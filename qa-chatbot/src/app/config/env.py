from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Set to True in production to enforce JWT / API-key authentication on every
    # protected endpoint.  False (default) lets all requests through without a token —
    # useful for local development and integration testing.
    AUTH_ENABLED: bool = False


@lru_cache
def get_env_settings() -> EnvSettings:
    return EnvSettings()
