from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Switch between "local" (Docker Postgres) and "supabase" (Supabase Postgres)
    DB_MODE: Literal["local", "supabase"] = "local"

    DATABASE_URL: PostgresDsn  # local Docker Postgres URL
    SUPABASE_DB_URL: PostgresDsn | None = None  # Supabase session pooler URL

    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 40

    @property
    def effective_url(self) -> str:
        """Active database URL — local or Supabase depending on DB_MODE."""
        if self.DB_MODE == "supabase":
            if self.SUPABASE_DB_URL is None:
                raise ValueError("DB_MODE=supabase requires SUPABASE_DB_URL to be set in .env")
            return str(self.SUPABASE_DB_URL)
        return str(self.DATABASE_URL)

    @property
    def effective_pool_size(self) -> int:
        """Supabase Nano caps total connections at 15 — keep pool within that."""
        return 5 if self.DB_MODE == "supabase" else self.DATABASE_POOL_SIZE

    @property
    def effective_max_overflow(self) -> int:
        return 5 if self.DB_MODE == "supabase" else self.DATABASE_MAX_OVERFLOW

    @property
    def is_supabase(self) -> bool:
        return self.DB_MODE == "supabase"


@lru_cache
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()
