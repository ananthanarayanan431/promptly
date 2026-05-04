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
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-haiku",
        "google/gemini-2.5-flash",
        "x-ai/grok-4.1-fast",
    ]

    # Maximum refinement loop iterations (council → critic → synthesize → quality_gate).
    # The loop exits early if quality_gate passes before hitting this ceiling.
    MAX_REFINEMENT_ITERATIONS: int = 3

    # When False, the quality_gate node is skipped entirely — synthesize goes straight to END.
    # Saves one LLM call per request at the cost of no post-synthesis quality scoring/looping.
    QUALITY_GATE_ENABLED: bool = True


@lru_cache
def get_llm_settings() -> LLMSettings:
    return LLMSettings()
