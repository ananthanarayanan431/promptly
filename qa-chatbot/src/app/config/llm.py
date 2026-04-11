from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    OPENROUTER_API_KEY: SecretStr
    DEFAULT_MODEL: str = "anthropic/claude-3.5-haiku"
    COUNCIL_MODELS: list[str] = [
        "anthropic/claude-3.5-haiku",
        "openai/gpt-4o-mini",
    ]


@lru_cache
def get_llm_settings() -> LLMSettings:
    return LLMSettings()
