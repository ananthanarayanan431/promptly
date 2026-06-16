"""Unit tests for the quality_gate node (mocked LLM)."""

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from promptly.graph.nodes import quality_gate as quality_gate_module
from promptly.graph.nodes.quality_gate import quality_gate_node

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
    "final_response": "This is the current synthesized output.",
    "reasoning": None,
    "iteration_count": 0,
    "max_iterations": 3,
    "previous_synthesis": None,
    "messages": [],
    "token_usage": {},
    "error": None,
}


def _make_mock_gate(content: str) -> MagicMock:
    mock = MagicMock()
    mock.model_name = "test-gate"
    mock_response = MagicMock()
    mock_response.content = content

    async def fake_ainvoke(messages: Any) -> MagicMock:
        return mock_response

    mock.ainvoke = fake_ainvoke
    return mock


_OK_RESPONSE = '{"overall": "pass", "weak_dimensions": [], "scores": {}, "rationale": "all good"}'
_FAIL_RESPONSE = (
    '{"overall": "fail", "weak_dimensions": ["output_format"],'
    ' "scores": {}, "rationale": "format missing"}'
)


# --------------------------------------------------------------------------- #
# 1. iteration_count >= max_iterations - 1 → exits WITHOUT calling LLM
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_hard_ceiling_no_llm_call():
    invoked = []

    async def fake_ainvoke(messages: Any) -> MagicMock:
        invoked.append(True)
        r = MagicMock()
        r.content = _OK_RESPONSE
        return r

    mock = MagicMock()
    mock.ainvoke = fake_ainvoke

    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 2  # max_iterations=3, so 2 >= 3-1 → ceiling
    state["max_iterations"] = 3

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    assert invoked == [], "LLM should not be called at the hard ceiling"
    assert result["iteration_count"] == 3
    assert result["previous_synthesis"] == state["final_response"]


# --------------------------------------------------------------------------- #
# 2. convergence detected → exits WITHOUT calling LLM
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_convergence_no_llm_call():
    invoked = []

    async def fake_ainvoke(messages: Any) -> MagicMock:
        invoked.append(True)
        r = MagicMock()
        r.content = _OK_RESPONSE
        return r

    mock = MagicMock()
    mock.ainvoke = fake_ainvoke

    state = copy.deepcopy(_BASE_STATE)
    state["final_response"] = "Identical synthesis text here."
    state["previous_synthesis"] = "Identical synthesis text here."  # exact match
    state["iteration_count"] = 0
    state["max_iterations"] = 3

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    assert invoked == [], "LLM should not be called on convergence"
    assert result["iteration_count"] == 1
    assert result["previous_synthesis"] == "Identical synthesis text here."


# --------------------------------------------------------------------------- #
# 3. LLM returns pass → decision is "exit", no sentinel appended
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_pass_decision_exit():
    mock = _make_mock_gate(_OK_RESPONSE)
    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 0
    state["previous_synthesis"] = None  # not converged

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    # On "pass" (exit), no sentinel should be added
    critic_responses = result.get("critic_responses", state["critic_responses"])
    sentinels = [c for c in critic_responses if c.get("_quality_gate")]
    assert sentinels == []
    assert result["iteration_count"] == 1


# --------------------------------------------------------------------------- #
# 4. LLM returns fail → decision is "loop", sentinel appended to critic_responses
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_fail_decision_loop_appends_sentinel():
    mock = _make_mock_gate(_FAIL_RESPONSE)
    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 0
    state["previous_synthesis"] = None
    state["critic_responses"] = []

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    sentinels = [c for c in result["critic_responses"] if c.get("_quality_gate")]
    assert len(sentinels) == 1
    assert sentinels[0]["weak_dimensions"] == ["output_format"]
    assert result["iteration_count"] == 1


# --------------------------------------------------------------------------- #
# 5. LLM scoring fails (Exception) → defaults to exit, no crash
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_scoring_exception_defaults_to_exit():
    mock = MagicMock()
    mock.model_name = "test-gate"

    async def boom(messages: Any) -> Any:
        raise RuntimeError("gate LLM failed")

    mock.ainvoke = boom

    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 0
    state["previous_synthesis"] = None

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    # Should return without error, iteration incremented
    assert result["iteration_count"] == 1
    assert result["previous_synthesis"] == state["final_response"]
    # No sentinel on exception exit
    assert "critic_responses" not in result or not any(
        c.get("_quality_gate") for c in result.get("critic_responses", [])
    )


# --------------------------------------------------------------------------- #
# 6. push_job_progress called with decision field when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_push_job_progress_called_with_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("promptly.graph.nodes.quality_gate.push_job_progress", push_mock)

    mock = _make_mock_gate(_OK_RESPONSE)
    state = copy.deepcopy(_BASE_STATE)
    state["job_id"] = "job-gate-1"
    state["iteration_count"] = 0
    state["previous_synthesis"] = None

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        await quality_gate_node(state)

    push_mock.assert_awaited_once()
    assert push_mock.await_args is not None
    payload = push_mock.await_args[0][1]
    assert "decision" in payload
    assert payload["decision"] == "exit"


# --------------------------------------------------------------------------- #
# 7. return value always includes iteration_count (incremented) and previous_synthesis
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_always_returns_iteration_and_previous_synthesis():
    mock = _make_mock_gate(_OK_RESPONSE)
    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 1
    state["previous_synthesis"] = "old synthesis"
    state["final_response"] = "new synthesis"

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    assert "iteration_count" in result
    assert result["iteration_count"] == 2
    assert "previous_synthesis" in result
    assert result["previous_synthesis"] == "new synthesis"


# --------------------------------------------------------------------------- #
# 8. loop decision: critic_responses has _quality_gate sentinel with weak_dimensions
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_loop_sentinel_has_weak_dimensions():
    fail_json = (
        '{"overall": "fail", "weak_dimensions": ["role_persona", "context_grounding"],'
        ' "scores": {}, "rationale": "persona and context missing"}'
    )
    mock = _make_mock_gate(fail_json)
    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 0
    state["previous_synthesis"] = None
    state["critic_responses"] = [
        {"ranking": ["A"], "ranking_rationale": "ok", "critiques": {}, "quality_gaps": []}
    ]

    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        result = await quality_gate_node(state)

    sentinels = [c for c in result["critic_responses"] if c.get("_quality_gate")]
    assert len(sentinels) == 1
    assert "role_persona" in sentinels[0]["weak_dimensions"]
    assert "context_grounding" in sentinels[0]["weak_dimensions"]
    # Original critic responses are preserved (not replaced)
    non_sentinels = [c for c in result["critic_responses"] if not c.get("_quality_gate")]
    assert len(non_sentinels) == 1


# --------------------------------------------------------------------------- #
# Bonus: push_job_progress called on hard-ceiling exit when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quality_gate_hard_ceiling_push_job_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("promptly.graph.nodes.quality_gate.push_job_progress", push_mock)

    state = copy.deepcopy(_BASE_STATE)
    state["iteration_count"] = 2
    state["max_iterations"] = 3
    state["job_id"] = "job-ceil"

    mock = _make_mock_gate(_OK_RESPONSE)
    with patch.object(quality_gate_module, "_get_gate_model", return_value=mock):
        await quality_gate_node(state)

    push_mock.assert_awaited_once()
    assert push_mock.await_args is not None
    payload = push_mock.await_args[0][1]
    assert payload["decision"] == "exit_max"
