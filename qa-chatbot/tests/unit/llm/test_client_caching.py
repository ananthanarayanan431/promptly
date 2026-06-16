"""Tests for the Anthropic prompt-cache injection in _CachingChatOpenAI.

These build the request payload via the public-ish ``_get_request_payload`` (no
network) and assert the cache_control breakpoint lands on the system prompt for
Anthropic models only, gated by PROMPT_CACHE_ENABLED.
"""

import pytest

from promptly.llm import _client
from promptly.llm._client import _CachingChatOpenAI, _is_anthropic
from promptly.llm.settings import get_llm_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_llm_settings.cache_clear()
    yield
    get_llm_settings.cache_clear()


def _model(name: str = "anthropic/claude-3.5-haiku") -> _CachingChatOpenAI:
    return _CachingChatOpenAI(
        model=name,
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key="test-key",
        temperature=0,
    )


def _messages() -> list[dict[str, str]]:
    return [
        {"role": "system", "content": "You are a senior prompt engineer."},
        {"role": "user", "content": "Improve this."},
    ]


def test_anthropic_injects_cache_breakpoint_on_system(monkeypatch):
    monkeypatch.delenv("PROMPT_CACHE_ENABLED", raising=False)  # default = enabled
    get_llm_settings.cache_clear()

    payload = _model()._get_request_payload(_messages())

    system = payload["messages"][0]
    assert isinstance(system["content"], list)
    block = system["content"][0]
    assert block["type"] == "text"
    assert block["text"] == "You are a senior prompt engineer."
    assert block["cache_control"] == {"type": "ephemeral"}
    # User turn stays a plain string (uncached)
    assert payload["messages"][1]["content"] == "Improve this."


def test_non_anthropic_payload_untouched(monkeypatch):
    monkeypatch.setenv("PROMPT_CACHE_ENABLED", "true")
    get_llm_settings.cache_clear()

    for name in ("openai/gpt-4o-mini", "google/gemini-2.5-flash", "x-ai/grok-4.1-fast"):
        payload = _model(name)._get_request_payload(_messages())
        assert payload["messages"][0]["content"] == "You are a senior prompt engineer."


def test_disabled_flag_payload_untouched(monkeypatch):
    monkeypatch.setenv("PROMPT_CACHE_ENABLED", "false")
    get_llm_settings.cache_clear()

    payload = _model()._get_request_payload(_messages())
    assert payload["messages"][0]["content"] == "You are a senior prompt engineer."


@pytest.mark.parametrize(
    "name,expected",
    [
        ("anthropic/claude-3.5-haiku", True),
        ("anthropic/claude-sonnet-4", True),
        ("claude-3-opus", True),
        ("some-router/claude-3.5", True),
        ("openai/gpt-4o-mini", False),
        ("google/gemini-2.5-flash", False),
        ("x-ai/grok-4.1-fast", False),
    ],
)
def test_is_anthropic_detection(name, expected):
    assert _is_anthropic(name) is expected


def test_build_returns_caching_client():
    model = _client._build("anthropic/claude-3.5-haiku", api_key="test-key")
    assert isinstance(model, _CachingChatOpenAI)
