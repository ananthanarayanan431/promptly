"""
Internal factory — builds a ChatOpenAI pointed at OpenRouter.

All llm/ modules call this instead of importing ChatOpenAI directly.
api_key is optional: if omitted, it is read from LLMSettings.
"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def _build(
    model: str,
    *,
    temperature: float = 0.0,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> ChatOpenAI:
    if api_key is None:
        from app.llm.settings import get_llm_settings

        api_key = get_llm_settings().OPENROUTER_API_KEY.get_secret_value()

    kwargs: dict[str, object] = dict(
        model=model,
        openai_api_base=_OPENROUTER_BASE,
        openai_api_key=api_key,
        temperature=temperature,
    )
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)
