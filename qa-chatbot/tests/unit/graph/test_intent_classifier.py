"""Unit tests for the intent_classifier node (mocked LLM)."""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from promptly.graph.nodes import intent_classifier
from promptly.graph.nodes.intent_classifier import _REJECTION_IRRELEVANT, intent_classifier_node

_BASE_STATE: dict[str, Any] = {
    "raw_prompt": "You are a helpful AI assistant. Answer questions clearly.",
    "session_id": "s1",
    "user_id": "u1",
    "feedback": None,
    "category_slug": None,
    "category_name": None,
    "category_description": None,
    "category_is_predefined": False,
    "version_history_diff": None,
    "job_id": None,
    "intent": None,
    "force_optimize": False,
    "already_optimized": False,
    "gate_dimension_scores": None,
    "gate_rationale": None,
    "council_responses": [],
    "critic_responses": [],
    "final_response": "",
    "reasoning": None,
    "iteration_count": 0,
    "max_iterations": 1,
    "previous_synthesis": None,
    "messages": [],
    "token_usage": {},
    "error": None,
}


def _make_mock_classifier(verdict: str) -> MagicMock:
    mock = MagicMock()
    mock_response = MagicMock()
    mock_response.content = verdict

    async def fake_ainvoke(messages: Any) -> MagicMock:
        return mock_response

    mock.ainvoke = fake_ainvoke
    return mock


@pytest.mark.asyncio
async def test_intent_classifier_optimize():
    state = {**_BASE_STATE}
    mock_classifier = _make_mock_classifier("OPTIMIZE")
    with patch.object(intent_classifier, "_get_classifier", return_value=mock_classifier):
        result = await intent_classifier_node(state)
    assert result["intent"] == "optimize"
    assert "final_response" not in result or result.get("final_response") != _REJECTION_IRRELEVANT


@pytest.mark.asyncio
async def test_intent_classifier_irrelevant():
    state = {**_BASE_STATE, "raw_prompt": "write me a prompt about cooking"}
    mock_classifier = _make_mock_classifier("IRRELEVANT")
    with patch.object(intent_classifier, "_get_classifier", return_value=mock_classifier):
        result = await intent_classifier_node(state)
    assert result["intent"] == "irrelevant"
    assert result["final_response"] == _REJECTION_IRRELEVANT
    assert result["error"] == _REJECTION_IRRELEVANT


@pytest.mark.asyncio
async def test_intent_classifier_case_insensitive_optimize():
    state = {**_BASE_STATE}
    mock_classifier = _make_mock_classifier("optimize")
    with patch.object(intent_classifier, "_get_classifier", return_value=mock_classifier):
        result = await intent_classifier_node(state)
    # "optimize" uppercased is "OPTIMIZE" — should return optimize
    assert result["intent"] == "optimize"


@pytest.mark.asyncio
async def test_intent_classifier_unknown_verdict_treated_as_optimize():
    state = {**_BASE_STATE}
    mock_classifier = _make_mock_classifier("SOME_UNKNOWN_VERDICT")
    with patch.object(intent_classifier, "_get_classifier", return_value=mock_classifier):
        result = await intent_classifier_node(state)
    # Non-IRRELEVANT verdict falls through to optimize
    assert result["intent"] == "optimize"


@pytest.mark.asyncio
async def test_intent_classifier_with_job_id(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock

    push_mock = AsyncMock()
    monkeypatch.setattr("promptly.graph.nodes.intent_classifier.push_job_progress", push_mock)

    state = {**_BASE_STATE, "job_id": "test-job-123"}
    mock_classifier = _make_mock_classifier("OPTIMIZE")
    with patch.object(intent_classifier, "_get_classifier", return_value=mock_classifier):
        result = await intent_classifier_node(state)
    assert result["intent"] == "optimize"
    push_mock.assert_awaited_once()
