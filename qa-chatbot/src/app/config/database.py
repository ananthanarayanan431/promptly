from functools import lru_cache
from pydantic import PostgresDsn
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    DATABASE_URL: PostgresDsn
    DATABASE_POOL_SIZE: int = 20 
    DATABASE_MAX_OVERFLOW: int = 40

@lru_cache
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()
