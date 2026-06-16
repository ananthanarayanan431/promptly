"""Tests for subject_classifier node: normalization logic and fail-open behavior."""

import copy
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from promptly.graph.nodes.subject_classifier import _normalize, subject_classifier_node

# ---------------------------------------------------------------------------
# Base state — mirrors the pattern in test_performance_gate.py
# ---------------------------------------------------------------------------

_BASE_STATE: dict[str, Any] = {
    "raw_prompt": "You are a helpful assistant. Summarize the document provided.",
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
    "subject_about": None,
    "subject_suggestions": None,
    "council_responses": [],
    "critic_responses": [],
    "final_response": "",
    "messages": [],
    "token_usage": {},
    "error": None,
    "iteration_count": 0,
    "max_iterations": 1,
    "previous_synthesis": None,
    "reasoning": None,
}


def _llm_response(payload: dict[str, Any]) -> MagicMock:
    m = MagicMock()
    m.content = json.dumps(payload)
    return m


# ---------------------------------------------------------------------------
# _normalize unit tests
# ---------------------------------------------------------------------------


def test_normalize_equal_valid_lists():
    about, suggestions = _normalize(["A.", "B."], ["X.", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_truncates_longer_list_to_shorter():
    about, suggestions = _normalize(["A.", "B.", "C."], ["X.", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_truncates_suggestions_when_shorter():
    about, suggestions = _normalize(["A.", "B."], ["X.", "Y.", "Z."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_caps_at_4():
    long = ["A.", "B.", "C.", "D.", "E."]
    about, suggestions = _normalize(long, long)
    assert about == ["A.", "B.", "C.", "D."]
    assert suggestions == ["A.", "B.", "C.", "D."]


def test_normalize_caps_then_equalizes():
    # about=5 items (capped to 4), suggestions=3 items → result is 3 each
    about, suggestions = _normalize(
        ["A.", "B.", "C.", "D.", "E."],
        ["X.", "Y.", "Z."],
    )
    assert len(about) == 3
    assert len(suggestions) == 3


def test_normalize_strips_whitespace():
    about, suggestions = _normalize(["  A.  "], ["  X.  "])
    assert about == ["A."]
    assert suggestions == ["X."]


def test_normalize_skips_empty_strings():
    about, suggestions = _normalize(["A.", "", "B."], ["X.", "", "Y."])
    assert about == ["A.", "B."]
    assert suggestions == ["X.", "Y."]


def test_normalize_returns_none_when_either_empty():
    assert _normalize([], ["X."]) == (None, None)
    assert _normalize(["A."], []) == (None, None)
    assert _normalize([], []) == (None, None)


def test_normalize_returns_none_for_non_list_input():
    assert _normalize(None, None) == (None, None)
    assert _normalize("bad", ["X."]) == (None, None)
    assert _normalize(["A."], 42) == (None, None)


# ---------------------------------------------------------------------------
# subject_classifier_node integration tests (LLM mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_node_returns_about_and_suggestions_on_success():
    payload = {
        "about": ["It summarizes documents.", "It targets a general audience."],
        "suggestions": ["Add a word-count constraint.", "Specify the output format."],
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] == ["It summarizes documents.", "It targets a general audience."]
    assert result["subject_suggestions"] == [
        "Add a word-count constraint.",
        "Specify the output format.",
    ]


@pytest.mark.asyncio
async def test_node_normalizes_unequal_counts():
    payload = {
        "about": ["A.", "B.", "C."],
        "suggestions": ["X.", "Y."],
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is not None
    assert result["subject_suggestions"] is not None
    assert len(result["subject_about"]) == len(result["subject_suggestions"])


@pytest.mark.asyncio
async def test_node_fail_open_on_invalid_json():
    mock_model = AsyncMock()
    bad = MagicMock()
    bad.content = "not json at all"
    mock_model.ainvoke = AsyncMock(return_value=bad)

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_fail_open_on_llm_exception():
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("network error"))

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_fail_open_when_lists_empty_after_normalize():
    payload = {"about": [], "suggestions": []}
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        result = await subject_classifier_node(copy.deepcopy(_BASE_STATE))  # type: ignore[arg-type]

    assert result["subject_about"] is None
    assert result["subject_suggestions"] is None


@pytest.mark.asyncio
async def test_node_passes_feedback_to_messages():
    """Node forwards state feedback to the prompt builder."""
    state_with_feedback = {**_BASE_STATE, "feedback": "Make it more concise"}
    payload = {
        "about": ["A document summarizer."],
        "suggestions": ["Make it more concise per user feedback."],
    }
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=_llm_response(payload))

    with patch("promptly.graph.nodes.subject_classifier._get_model", return_value=mock_model):
        with patch(
            "promptly.graph.nodes.subject_classifier.subject_classifier_messages"
        ) as mock_msgs:
            mock_msgs.return_value = [
                {"role": "system", "content": "s"},
                {"role": "user", "content": "u"},
            ]
            await subject_classifier_node(state_with_feedback)  # type: ignore[arg-type]

    mock_msgs.assert_called_once_with(
        "You are a helpful assistant. Summarize the document provided.",
        "Make it more concise",
    )
