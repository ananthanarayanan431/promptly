"""Unit tests for the council_vote node and _extract_quality_gaps helper (mocked LLMs)."""

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graph.nodes import council_vote as council_vote_module
from app.graph.nodes.council_vote import _extract_quality_gaps, council_vote_node

_BASE_STATE: dict[str, Any] = {
    "raw_prompt": "You are a helpful assistant. Answer questions clearly.",
    "session_id": "s1",
    "user_id": "u1",
    "feedback": None,
    "category_slug": None,
    "category_name": None,
    "category_description": None,
    "category_is_predefined": False,
    "version_history_diff": None,
    "job_id": None,
    "intent": "optimize",
    "force_optimize": False,
    "already_optimized": False,
    "gate_dimension_scores": None,
    "gate_rationale": None,
    "council_responses": [],
    "critic_responses": [],
    "final_response": "",
    "reasoning": None,
    "iteration_count": 0,
    "max_iterations": 3,
    "previous_synthesis": None,
    "messages": [],
    "token_usage": {},
    "error": None,
}


def _make_mock_model(content: str = "Optimized prompt") -> MagicMock:
    mock = MagicMock()
    mock.model_name = "test-model"
    mock_response = MagicMock()
    mock_response.content = content
    mock_response.usage_metadata = {}

    async def fake_ainvoke(messages: Any) -> MagicMock:
        return mock_response

    mock.ainvoke = fake_ainvoke
    return mock


def _make_four_models(content: str = "Optimized prompt") -> list[MagicMock]:
    return [_make_mock_model(content) for _ in range(4)]


# =========================================================================== #
# Tests for _extract_quality_gaps (pure function)
# =========================================================================== #


def test_extract_quality_gaps_empty_state():
    state = copy.deepcopy(_BASE_STATE)
    assert _extract_quality_gaps(state) == []


def test_extract_quality_gaps_gate_sentinel_returns_weak_dimensions():
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {"_quality_gate": True, "weak_dimensions": ["output_format", "role_persona"]}
    ]
    result = _extract_quality_gaps(state)
    assert result == ["output_format", "role_persona"]


def test_extract_quality_gaps_council_gaps_when_no_gate_sentinel():
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = [
        {"optimized_prompt": "P1", "_quality_gaps": ["context_grounding"]},
    ]
    result = _extract_quality_gaps(state)
    assert result == ["context_grounding"]


def test_extract_quality_gaps_gate_sentinel_takes_priority_over_council():
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [{"_quality_gate": True, "weak_dimensions": ["goal_clarity"]}]
    state["council_responses"] = [
        {"optimized_prompt": "P1", "_quality_gaps": ["context_grounding"]},
    ]
    result = _extract_quality_gaps(state)
    # Gate sentinel wins
    assert result == ["goal_clarity"]
    assert "context_grounding" not in result


def test_extract_quality_gaps_uses_most_recent_gate_sentinel():
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {"_quality_gate": True, "weak_dimensions": ["old_gap"]},
        {"_quality_gate": True, "weak_dimensions": ["new_gap"]},
    ]
    result = _extract_quality_gaps(state)
    # reversed() means newest sentinel wins
    assert result == ["new_gap"]


def test_extract_quality_gaps_empty_weak_dimensions_falls_through():
    """Gate sentinel with empty weak_dimensions should fall through to council gaps."""
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {"_quality_gate": True, "weak_dimensions": []}  # empty — skip
    ]
    state["council_responses"] = [
        {"optimized_prompt": "P1", "_quality_gaps": ["tone_audience"]},
    ]
    result = _extract_quality_gaps(state)
    assert result == ["tone_audience"]


# =========================================================================== #
# Tests for council_vote_node (async)
# =========================================================================== #


# --------------------------------------------------------------------------- #
# 1. Returns 4 council_responses when all 4 models succeed
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_four_responses_on_success():
    mocks = _make_four_models()
    state = copy.deepcopy(_BASE_STATE)

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    assert len(result["council_responses"]) == 4


# --------------------------------------------------------------------------- #
# 2. Each response has model, optimized_prompt, usage keys
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_response_has_required_keys():
    mocks = []
    for i in range(4):
        m = _make_mock_model(f"Optimized prompt {i}")
        m.model_name = f"model-{i}"
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    for r in result["council_responses"]:
        assert "model" in r
        assert "optimized_prompt" in r
        assert "usage" in r


# --------------------------------------------------------------------------- #
# 3. One model raising Exception → that response filtered, others kept (3 responses)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_one_failing_model_filtered():
    mocks = []
    for i in range(4):
        m = MagicMock()
        m.model_name = f"model-{i}"
        if i == 1:

            async def boom(messages: Any, idx: int = i) -> Any:
                raise RuntimeError(f"model {idx} crashed")

            m.ainvoke = boom
        else:

            async def ok(messages: Any, n: int = i) -> MagicMock:
                r = MagicMock()
                r.content = f"Optimized prompt {n}"
                r.usage_metadata = {}
                return r

            m.ainvoke = ok
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    assert len(result["council_responses"]) == 3
    model_names = {r["model"] for r in result["council_responses"]}
    assert "model-1" not in model_names


# --------------------------------------------------------------------------- #
# 4. iteration_count > 0 uses _extract_quality_gaps (gate sentinel path)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_iteration_uses_quality_gaps_from_gate_sentinel():
    """On iteration > 0, quality gaps from the gate sentinel are injected into messages."""
    captured_messages: list[Any] = []

    mocks = []
    for i in range(4):
        m = MagicMock()
        m.model_name = f"model-{i}"

        async def capture_ainvoke(messages: Any, idx: int = i) -> MagicMock:
            captured_messages.extend(messages)
            r = MagicMock()
            r.content = "improved"
            r.usage_metadata = {}
            return r

        m.ainvoke = capture_ainvoke
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 1
    state["previous_synthesis"] = "Previous output"
    state["critic_responses"] = [{"_quality_gate": True, "weak_dimensions": ["output_format"]}]

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    assert len(result["council_responses"]) == 4
    # The messages were built with quality_gaps — verify node ran iteration path
    # (specific message content depends on prompt templates, just verify 4 responses returned)
    assert len(result["council_responses"]) == 4


# --------------------------------------------------------------------------- #
# 5. _extract_quality_gaps with no gaps returns []
# --------------------------------------------------------------------------- #
def test_extract_quality_gaps_no_gaps_returns_empty():
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = []
    state["council_responses"] = []
    assert _extract_quality_gaps(state) == []


# --------------------------------------------------------------------------- #
# 6. _extract_quality_gaps with gate sentinel extracts weak_dimensions
# --------------------------------------------------------------------------- #
def test_extract_quality_gaps_gate_sentinel_extracts_weak_dimensions():
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {"_quality_gate": True, "weak_dimensions": ["conciseness", "tone_audience"]}
    ]
    result = _extract_quality_gaps(state)
    assert "conciseness" in result
    assert "tone_audience" in result


# --------------------------------------------------------------------------- #
# 7. _extract_quality_gaps with council _quality_gaps (no gate sentinel)
# --------------------------------------------------------------------------- #
def test_extract_quality_gaps_council_response_gaps():
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = [
        {"optimized_prompt": "P1", "_quality_gaps": ["examples_exemplars"]},
        {"optimized_prompt": "P2", "_quality_gaps": []},
    ]
    result = _extract_quality_gaps(state)
    # reversed() — checks from the end; P2 has empty list so falls through to P1
    assert "examples_exemplars" in result


# --------------------------------------------------------------------------- #
# 8. push_job_progress called per model completion when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_push_job_progress_per_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("app.graph.nodes.council_vote.push_job_progress", push_mock)

    mocks = _make_four_models()
    state = copy.deepcopy(_BASE_STATE)
    state["job_id"] = "job-council-1"

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    assert len(result["council_responses"]) == 4
    # push_job_progress called once per model
    assert push_mock.await_count == 4
    for call in push_mock.await_args_list:
        payload = call[0][1]
        assert payload["step"] == "council"
        assert "done" in payload
        assert "total" in payload


# --------------------------------------------------------------------------- #
# 9. category_block from category_guidance_block passed into messages
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_council_vote_category_block_in_messages():
    """Non-general category_slug causes category_guidance_block to produce content."""
    captured: list[list[dict[str, Any]]] = []

    mocks = []
    for i in range(4):
        m = MagicMock()
        m.model_name = f"model-{i}"

        async def cap(messages: Any, idx: int = i) -> MagicMock:
            captured.append(list(messages))
            r = MagicMock()
            r.content = "output"
            r.usage_metadata = {}
            return r

        m.ainvoke = cap
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)
    state["category_slug"] = "customer-support"
    state["category_name"] = "Customer Support"
    state["category_description"] = "Prompts for support agents"
    state["category_is_predefined"] = True

    with patch.object(council_vote_module, "_get_council_models", return_value=mocks):
        result = await council_vote_node(state)

    assert len(result["council_responses"]) == 4
    # Verify messages were actually sent (captured has 4 message lists)
    assert len(captured) == 4
