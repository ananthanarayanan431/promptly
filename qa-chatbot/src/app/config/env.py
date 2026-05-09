from functools import lru_cache

from pydantic import SecretStr
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


class MinioSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    MINIO_ENDPOINT_URL: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str
    MINIO_SECRET_KEY: SecretStr
    MINIO_BUCKET_NAME: str = "promptly"


@lru_cache
def get_env_settings() -> EnvSettings:
    return EnvSettings()


@lru_cache
def get_minio_settings() -> MinioSettings:
    return MinioSettings()
