"""Unit tests for openrouter helper functions (pure logic)."""

from app.api.v1.openrouter import _cost_per_token


def test_cost_per_token_known_model_gpt4o_mini() -> None:
    cost = _cost_per_token("openai/gpt-4o-mini")
    assert cost == 0.30 / 1_000_000


def test_cost_per_token_known_model_claude_haiku() -> None:
    cost = _cost_per_token("anthropic/claude-3.5-haiku")
    assert cost == 2.40 / 1_000_000


def test_cost_per_token_known_model_gemini_flash() -> None:
    cost = _cost_per_token("google/gemini-2.0-flash")
    assert cost == 0.25 / 1_000_000


def test_cost_per_token_known_model_grok() -> None:
    cost = _cost_per_token("x-ai/grok-2")
    assert cost == 6.00 / 1_000_000


def test_cost_per_token_unknown_model_returns_default() -> None:
    cost = _cost_per_token("somevendor/unknown-model-xyz")
    assert cost == 1.00 / 1_000_000


def test_cost_per_token_no_provider_prefix() -> None:
    cost = _cost_per_token("gpt-4o-mini")
    assert cost == 0.30 / 1_000_000


def test_cost_per_token_prefix_match() -> None:
    # "gpt-4o-mini-something" starts with "gpt-4o-mini"
    cost = _cost_per_token("openai/gpt-4o-mini-extended")
    assert cost == 0.30 / 1_000_000
