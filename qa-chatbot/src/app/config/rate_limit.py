from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

class RateLimitSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

@lru_cache
def get_rate_limit_settings() -> RateLimitSettings:
    return RateLimitSettings()
