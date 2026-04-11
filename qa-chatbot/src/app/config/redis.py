from functools import lru_cache

from pydantic import RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class RedisSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    REDIS_URL: RedisDsn = "redis://localhost:6379/0"  # type: ignore
    REDIS_TTL_SECONDS: int = 3600


@lru_cache
def get_redis_settings() -> RedisSettings:
    return RedisSettings()
