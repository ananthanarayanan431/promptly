"""
Internal factory — builds a ChatOpenAI pointed at OpenRouter.

All llm/ modules call this instead of importing ChatOpenAI directly.
api_key is optional: if omitted, it is read from LLMSettings.

Anthropic prompt caching
------------------------
OpenRouter auto-caches the static system-prompt prefix for OpenAI, Gemini and
xAI models. Anthropic is the exception: it only caches a request that carries an
explicit ``cache_control`` breakpoint on a content block — a plain-string system
message is never cached (OpenRouter ai-sdk issue #389), and it is NOT a
constructor/`model_kwargs` argument (langchain issue #35920). So the breakpoint
must be injected into the request payload itself.

``_CachingChatOpenAI`` does exactly that: it overrides ``_get_request_payload``
and, for Anthropic models only, marks the system prompt with a 5-minute ephemeral
breakpoint. Injecting after ``super()._get_request_payload`` means the block is
added to the final wire payload, past all of LangChain's message formatting —
so it reaches OpenRouter untouched. Non-Anthropic models and the disabled flag
return the payload unchanged.
"""

from __future__ import annotations

from typing import Any

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def _is_anthropic(model_name: str) -> bool:
    name = model_name.lower()
    return "anthropic/" in name or "/claude" in name or name.startswith("claude")


def _mark_system_cache(messages: list[dict[str, Any]]) -> None:
    """Mark the first string ``system`` message with an ephemeral cache breakpoint, in place.

    Only the static system prompt is marked; the dynamic user turn that follows
    stays uncached so the cached prefix is shared across requests.
    """
    for msg in messages:
        if msg.get("role") == "system" and isinstance(msg.get("content"), str):
            msg["content"] = [
                {
                    "type": "text",
                    "text": msg["content"],
                    "cache_control": {"type": "ephemeral"},
                }
            ]
            return


class _CachingChatOpenAI(ChatOpenAI):
    """ChatOpenAI that adds an Anthropic prompt-cache breakpoint to the system prompt."""

    def _get_request_payload(
        self,
        input_: Any,  # noqa: ANN401 — mirrors BaseChatOpenAI's LanguageModelInput
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = super()._get_request_payload(input_, stop=stop, **kwargs)

        from app.llm.settings import get_llm_settings

        if (
            get_llm_settings().PROMPT_CACHE_ENABLED
            and _is_anthropic(self.model_name)
            and isinstance(payload.get("messages"), list)
        ):
            _mark_system_cache(payload["messages"])
        return payload


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

    return _CachingChatOpenAI(
        model=model,
        base_url=_OPENROUTER_BASE,
        api_key=SecretStr(api_key),
        temperature=temperature,
        model_kwargs={"max_tokens": max_tokens} if max_tokens is not None else {},
    )
