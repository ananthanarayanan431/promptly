"""Unit tests for the synthesize node (mocked LLM)."""

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from promptly.graph.nodes import synthesize as synthesize_module
from promptly.graph.nodes.synthesize import synthesize_node

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
    "council_responses": [
        {"optimized_prompt": "Proposal A", "usage": {"total_tokens": 100}},
        {"optimized_prompt": "Proposal B", "usage": {"total_tokens": 120}},
        {"optimized_prompt": "Proposal C", "usage": {"total_tokens": 90}},
        {"optimized_prompt": "Proposal D", "usage": {"total_tokens": 110}},
    ],
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


def _make_two_call_mock(synthesis_content: str, reasoning_content: str) -> MagicMock:
    """Return a mock LLM that alternates: synthesis on call 1, reasoning on call 2."""
    mock = MagicMock()
    mock.model_name = "test-model"
    call_count = [0]
    responses = [synthesis_content, reasoning_content]

    async def fake_ainvoke(messages: Any) -> MagicMock:
        r = MagicMock()
        r.content = responses[min(call_count[0], len(responses) - 1)]
        r.usage_metadata = {}
        call_count[0] += 1
        return r

    mock.ainvoke = fake_ainvoke
    return mock


def _make_single_call_mock(content: str) -> MagicMock:
    mock = MagicMock()
    mock.model_name = "test-model"

    async def fake_ainvoke(messages: Any) -> MagicMock:
        r = MagicMock()
        r.content = content
        r.usage_metadata = {}
        return r

    mock.ainvoke = fake_ainvoke
    return mock


# --------------------------------------------------------------------------- #
# 1. final_response from first LLM call content
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_returns_final_response():
    reasoning_json = '{"summary": "improved", "changes": [], "kept": ["tone"]}'
    mock = _make_two_call_mock("Optimized prompt text", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["final_response"] == "Optimized prompt text"


# --------------------------------------------------------------------------- #
# 2. reasoning parsed from second LLM call (valid JSON)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_parses_reasoning_json():
    reasoning_json = '{"summary": "improved", "changes": ["added context"], "kept": ["tone"]}'
    mock = _make_two_call_mock("Optimized prompt text", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["reasoning"] is not None
    assert result["reasoning"]["summary"] == "improved"
    assert result["reasoning"]["kept"] == ["tone"]


# --------------------------------------------------------------------------- #
# 3. reasoning JSON wrapped in ```json fences — parses correctly
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_reasoning_json_in_fences():
    fenced = '```json\n{"summary": "fenced", "changes": [], "kept": []}\n```'
    mock = _make_two_call_mock("Optimized prompt text", fenced)
    state = copy.deepcopy(_BASE_STATE)
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["reasoning"] is not None
    assert result["reasoning"]["summary"] == "fenced"


# --------------------------------------------------------------------------- #
# 4. reasoning failure gracefully — reasoning is None, no crash
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_reasoning_failure_graceful():
    mock = MagicMock()
    mock.model_name = "test-model"
    call_count = [0]

    async def fake_ainvoke(messages: Any) -> MagicMock:
        call_count[0] += 1
        if call_count[0] == 1:
            r = MagicMock()
            r.content = "Synthesized output"
            r.usage_metadata = {}
            return r
        raise RuntimeError("reasoning LLM blew up")

    mock.ainvoke = fake_ainvoke
    state = copy.deepcopy(_BASE_STATE)
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["final_response"] == "Synthesized output"
    assert result["reasoning"] is None


# --------------------------------------------------------------------------- #
# 5. total_tokens calculated from council_responses usage
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_total_tokens_from_council():
    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    # 100 + 120 + 90 + 110 = 420
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["token_usage"]["total_tokens"] == 420


# --------------------------------------------------------------------------- #
# 6. _quality_gate sentinel entries are filtered from critic_responses
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_filters_quality_gate_sentinels():
    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {
            "ranking": ["A", "B", "C"],
            "ranking_rationale": "A is best",
            "critiques": {},
            "quality_gaps": [],
        },
        {"_quality_gate": True, "weak_dimensions": ["output_format"]},
    ]
    # Should not raise; sentinels excluded from critiques_block
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["final_response"] == "Output"


# --------------------------------------------------------------------------- #
# 7. push_job_progress called when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_calls_push_job_progress_with_job_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("promptly.graph.nodes.synthesize.push_job_progress", push_mock)

    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    state["job_id"] = "job-abc"
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        await synthesize_node(state)
    push_mock.assert_awaited_once()
    call_args = push_mock.await_args
    assert call_args is not None
    assert call_args[0][0] == "job-abc"
    assert call_args[0][1]["step"] == "synthesize"


# --------------------------------------------------------------------------- #
# 8. no job_id — push_job_progress NOT called
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_no_push_without_job_id(monkeypatch: pytest.MonkeyPatch) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("promptly.graph.nodes.synthesize.push_job_progress", push_mock)

    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    state["job_id"] = None
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        await synthesize_node(state)
    push_mock.assert_not_awaited()


# --------------------------------------------------------------------------- #
# 9. quality_gate sentinel in critic_responses → weak_dimensions as quality_gaps
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_extracts_quality_gaps_from_gate_sentinel():
    """Verifies node completes without error when gate sentinels carry weak_dimensions."""
    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    state["critic_responses"] = [
        {"_quality_gate": True, "weak_dimensions": ["output_format", "role_persona"]},
    ]
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    # Node should complete and return final_response
    assert result["final_response"] == "Output"


# --------------------------------------------------------------------------- #
# 10. empty council_responses — still completes
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_synthesize_with_empty_council_responses():
    reasoning_json = '{"summary": "s", "changes": [], "kept": []}'
    mock = _make_two_call_mock("Output from empty council", reasoning_json)
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = []
    with patch.object(synthesize_module, "_get_synthesizer", return_value=mock):
        result = await synthesize_node(state)
    assert result["final_response"] == "Output from empty council"
    assert result["token_usage"]["total_tokens"] == 0
