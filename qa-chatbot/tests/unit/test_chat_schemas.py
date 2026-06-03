"""Unit tests for optimize schemas — ChatRequest validator and MessageOut._unpack_gate_fields."""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.optimize.api.schemas import ChatRequest, MessageOut, ReasoningBlock

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base_message_out(**overrides: object) -> MessageOut:
    """Build a minimal valid MessageOut with optional overrides."""
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "role": "user",
        "raw_prompt": "original prompt",
        "response": "optimized prompt",
        "created_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    return MessageOut(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# ChatRequest validator
# ---------------------------------------------------------------------------


def test_chat_request_raises_if_neither_prompt_nor_prompt_id() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ChatRequest()
    errors = exc_info.value.errors()
    messages = [e["msg"] for e in errors]
    assert any("prompt" in m.lower() or "prompt_id" in m.lower() for m in messages)


def test_chat_request_accepts_with_just_prompt() -> None:
    req = ChatRequest(prompt="Summarise the following text.")
    assert req.prompt == "Summarise the following text."
    assert req.prompt_id is None


def test_chat_request_accepts_with_just_prompt_id() -> None:
    pid = uuid.uuid4()
    req = ChatRequest(prompt_id=pid)
    assert req.prompt_id == pid
    assert req.prompt is None


def test_chat_request_accepts_with_both_prompt_and_prompt_id() -> None:
    pid = uuid.uuid4()
    req = ChatRequest(prompt="My prompt", prompt_id=pid)
    assert req.prompt == "My prompt"
    assert req.prompt_id == pid


def test_chat_request_prompt_min_length_one() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(prompt="")


def test_chat_request_accepts_optional_fields() -> None:
    req = ChatRequest(
        prompt="Write a haiku.",
        name="haiku-family",
        feedback="Keep it under 17 syllables",
        category_slug="writing",
        force_optimize=True,
    )
    assert req.name == "haiku-family"
    assert req.feedback == "Keep it under 17 syllables"
    assert req.category_slug == "writing"
    assert req.force_optimize is True


# ---------------------------------------------------------------------------
# MessageOut._unpack_gate_fields
# ---------------------------------------------------------------------------


def test_message_out_already_optimized_set_from_token_usage() -> None:
    msg = _base_message_out(token_usage={"_already_optimized": True})
    assert msg.already_optimized is True


def test_message_out_already_optimized_false_when_flag_absent() -> None:
    msg = _base_message_out(token_usage={"total_tokens": 500})
    assert msg.already_optimized is False


def test_message_out_gate_dimension_scores_unpacked_from_token_usage() -> None:
    scores = {"clarity": "high", "specificity": "medium", "brevity": "low"}
    msg = _base_message_out(
        token_usage={
            "_already_optimized": True,
            "_gate_dimension_scores": scores,
        }
    )
    assert msg.gate_dimension_scores == scores


def test_message_out_gate_dimension_scores_values_coerced_to_str() -> None:
    msg = _base_message_out(
        token_usage={
            "_already_optimized": True,
            "_gate_dimension_scores": {"clarity": 1, "specificity": 0},
        }
    )
    assert msg.gate_dimension_scores == {"clarity": "1", "specificity": "0"}


def test_message_out_gate_rationale_unpacked_from_token_usage() -> None:
    msg = _base_message_out(
        token_usage={
            "_already_optimized": True,
            "_gate_rationale": "Prompt already meets all quality dimensions.",
        }
    )
    assert msg.gate_rationale == "Prompt already meets all quality dimensions."


def test_message_out_reasoning_unpacked_from_token_usage() -> None:
    reasoning_data = {
        "summary": "Added structure and clarity.",
        "changes": [{"kind": "addition", "title": "Headers", "detail": "Added section headers"}],
        "kept": ["tone", "length"],
    }
    msg = _base_message_out(token_usage={"_reasoning": reasoning_data})
    assert isinstance(msg.reasoning, ReasoningBlock)
    assert msg.reasoning.summary == "Added structure and clarity."
    assert len(msg.reasoning.changes) == 1
    assert msg.reasoning.changes[0].kind == "addition"
    assert msg.reasoning.kept == ["tone", "length"]


def test_message_out_invalid_reasoning_silently_ignored() -> None:
    """Malformed _reasoning dict should not crash — reasoning stays None."""
    msg = _base_message_out(
        token_usage={
            "_reasoning": {"invalid_key": "no summary or changes here"},
        }
    )
    assert msg.reasoning is None


def test_message_out_non_dict_reasoning_silently_ignored() -> None:
    """A non-dict _reasoning value should not crash."""
    msg = _base_message_out(token_usage={"_reasoning": "not a dict"})
    assert msg.reasoning is None


def test_message_out_gate_dimension_scores_none_when_not_already_optimized() -> None:
    """gate_dimension_scores should not be set when _already_optimized is falsy."""
    msg = _base_message_out(
        token_usage={
            "_already_optimized": False,
            "_gate_dimension_scores": {"clarity": "high"},
        }
    )
    assert msg.gate_dimension_scores is None


def test_message_out_no_token_usage_defaults_all_gate_fields() -> None:
    msg = _base_message_out(token_usage=None)
    assert msg.already_optimized is False
    assert msg.gate_dimension_scores is None
    assert msg.gate_rationale is None
    assert msg.reasoning is None


def test_message_out_empty_token_usage_defaults_all_gate_fields() -> None:
    msg = _base_message_out(token_usage={})
    assert msg.already_optimized is False
    assert msg.gate_dimension_scores is None
    assert msg.gate_rationale is None
    assert msg.reasoning is None
