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

    # Four models — each independently optimizes with the same unified prompt.
    # All are routed through OpenRouter.
    COUNCIL_MODELS: list[str] = [
        "openai/gpt-4o-mini",  # 0 → analytical
        "anthropic/claude-3.5-haiku",  # 1 → creative
        "google/gemini-2.5-flash",  # 2 → concise
        "x-ai/grok-4.1-fast",  # 3 → structured
    ]


@lru_cache
def get_llm_settings() -> LLMSettings:
    return LLMSettings()
