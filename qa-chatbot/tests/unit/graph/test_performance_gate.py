"""Unit tests for the performance_gate node."""

import copy
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graph.nodes.performance_gate import _scores_satisfy_bar, performance_gate_node

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_STATE: dict[str, Any] = {
    "raw_prompt": (
        "You are an expert Python developer. Rewrite the following function to be more "
        "Pythonic, preserve all existing behaviour, and add type annotations. "
        "Return only the rewritten function, no explanation."
    ),
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
    "messages": [],
    "token_usage": {},
    "error": None,
    "iteration_count": 0,
    "max_iterations": 1,
    "previous_synthesis": None,
}


def _make_llm_response(payload: dict[str, Any]) -> MagicMock:
    m = MagicMock()
    m.content = json.dumps(payload)
    return m


def _all_strong() -> dict[str, str]:
    return {
        "role_persona": "strong",
        "goal_clarity": "strong",
        "context_grounding": "strong",
        "output_format": "strong",
        "examples_exemplars": "strong",
        "constraints_guardrails": "strong",
        "tone_audience": "strong",
        "conciseness": "strong",
    }


# ---------------------------------------------------------------------------
# _scores_satisfy_bar unit tests
# ---------------------------------------------------------------------------


def test_all_strong_passes():
    assert _scores_satisfy_bar(_all_strong()) is True


def test_one_weak_passes():
    scores = _all_strong()
    scores["conciseness"] = "weak"
    assert _scores_satisfy_bar(scores) is True


def test_two_weak_fails():
    scores = _all_strong()
    scores["conciseness"] = "weak"
    scores["role_persona"] = "weak"
    assert _scores_satisfy_bar(scores) is False


def test_any_missing_fails():
    scores = _all_strong()
    scores["constraints_guardrails"] = "missing"
    assert _scores_satisfy_bar(scores) is False


def test_goal_clarity_weak_fails():
    scores = _all_strong()
    scores["goal_clarity"] = "weak"
    assert _scores_satisfy_bar(scores) is False


def test_goal_clarity_missing_fails():
    scores = _all_strong()
    scores["goal_clarity"] = "missing"
    assert _scores_satisfy_bar(scores) is False


def test_one_weak_plus_goal_clarity_weak_fails():
    scores = _all_strong()
    scores["goal_clarity"] = "weak"
    scores["conciseness"] = "weak"
    assert _scores_satisfy_bar(scores) is False


# ---------------------------------------------------------------------------
# performance_gate_node integration tests (LLM mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_fires_when_all_strong():
    """Gate sets already_optimized=True when LLM returns all-strong scores."""
    scores = _all_strong()
    llm_payload = {
        "scores": scores,
        "already_optimized": True,
        "rationale": "All dimensions are fully addressed.",
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_make_llm_response(llm_payload))

    with patch("app.graph.nodes.performance_gate._get_gate_model", return_value=mock_model):
        result = await performance_gate_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["already_optimized"] is True
    assert result["gate_dimension_scores"] == scores
    assert result["gate_rationale"] == "All dimensions are fully addressed."
    assert result["final_response"] == _BASE_STATE["raw_prompt"]
    assert result["council_responses"] == []
    assert result["critic_responses"] == []


@pytest.mark.asyncio
async def test_gate_does_not_fire_for_weak_prompt():
    """Gate leaves already_optimized=False when prompt has too many weak dimensions."""
    scores = _all_strong()
    scores["conciseness"] = "weak"
    scores["role_persona"] = "weak"
    llm_payload = {
        "scores": scores,
        "already_optimized": False,
        "rationale": "Two weak dimensions present.",
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_make_llm_response(llm_payload))

    with patch("app.graph.nodes.performance_gate._get_gate_model", return_value=mock_model):
        result = await performance_gate_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["already_optimized"] is False
    assert result.get("gate_dimension_scores") is None
    assert result.get("gate_rationale") is None


@pytest.mark.asyncio
async def test_gate_fail_open_on_invalid_json():
    """Malformed LLM response → gate treats as not optimized and lets pipeline proceed."""
    mock_model = AsyncMock()
    bad_response = MagicMock()
    bad_response.content = "This is not JSON at all"
    mock_model.ainvoke = AsyncMock(return_value=bad_response)

    with patch("app.graph.nodes.performance_gate._get_gate_model", return_value=mock_model):
        result = await performance_gate_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["already_optimized"] is False


@pytest.mark.asyncio
async def test_gate_fail_open_on_llm_exception():
    """LLM raises an exception → gate fails open, proceeds to council."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("timeout"))

    with patch("app.graph.nodes.performance_gate._get_gate_model", return_value=mock_model):
        result = await performance_gate_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["already_optimized"] is False


@pytest.mark.asyncio
async def test_gate_rejects_llm_pass_when_scores_fail_bar():
    """LLM claims already_optimized=True but scores have 2 weak → node overrides to False."""
    scores = _all_strong()
    scores["conciseness"] = "weak"
    scores["role_persona"] = "weak"
    # LLM claims pass despite bad scores — node must re-evaluate deterministically
    llm_payload = {
        "scores": scores,
        "already_optimized": True,
        "rationale": "LLM is wrong here.",
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_make_llm_response(llm_payload))

    with patch("app.graph.nodes.performance_gate._get_gate_model", return_value=mock_model):
        result = await performance_gate_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    # Node overrides the LLM's already_optimized verdict with deterministic check
    assert result["already_optimized"] is False
