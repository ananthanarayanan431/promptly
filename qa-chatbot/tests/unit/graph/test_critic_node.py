"""Unit tests for the critic node (mocked LLMs)."""

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graph.nodes import critic as critic_module
from app.graph.nodes.critic import critic_node

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

_FOUR_PROPOSALS = [
    {"optimized_prompt": f"Proposal {c}", "usage": {"total_tokens": 50}, "model": f"m{i}"}
    for i, c in enumerate(["A", "B", "C", "D"])
]

_VALID_CRITIC_JSON = (
    '{"ranking": ["A", "B", "C"], "ranking_rationale": "A is best",'
    ' "critiques": {}, "quality_gaps": ["output_format"]}'
)


def _make_mock_critic(content: str) -> MagicMock:
    mock = MagicMock()
    mock.model_name = "test-model"
    mock_response = MagicMock()
    mock_response.content = content

    async def fake_ainvoke(messages: Any) -> MagicMock:
        return mock_response

    mock.ainvoke = fake_ainvoke
    return mock


def _make_four_critics(content: str = _VALID_CRITIC_JSON) -> list[MagicMock]:
    return [_make_mock_critic(content) for _ in range(4)]


# --------------------------------------------------------------------------- #
# 1. < 4 proposals → returns {"critic_responses": []} early, no LLM calls
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_fewer_than_4_proposals_returns_early():
    invoked = []

    async def fake_ainvoke(messages: Any) -> MagicMock:
        invoked.append(True)
        r = MagicMock()
        r.content = _VALID_CRITIC_JSON
        return r

    mocks = _make_four_critics()
    for m in mocks:
        m.ainvoke = fake_ainvoke

    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = _FOUR_PROPOSALS[:3]  # only 3

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    assert result == {"critic_responses": []}
    assert invoked == [], "No LLM calls should happen with < 4 proposals"


# --------------------------------------------------------------------------- #
# 2. exactly 4 proposals — calls 4 LLMs in parallel
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_four_proposals_calls_four_llms():
    call_counts = [0]

    async def fake_ainvoke(messages: Any) -> MagicMock:
        call_counts[0] += 1
        r = MagicMock()
        r.content = _VALID_CRITIC_JSON
        return r

    mocks = _make_four_critics()
    for m in mocks:
        m.ainvoke = fake_ainvoke

    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    assert call_counts[0] == 4
    assert len(result["critic_responses"]) == 4


# --------------------------------------------------------------------------- #
# 3. each critic response includes reviewer_model from model.model_name
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_response_includes_reviewer_model():
    mocks = []
    for i in range(4):
        m = _make_mock_critic(_VALID_CRITIC_JSON)
        m.model_name = f"model-{i}"
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    reviewer_models = {cr["reviewer_model"] for cr in result["critic_responses"]}
    assert reviewer_models == {"model-0", "model-1", "model-2", "model-3"}


# --------------------------------------------------------------------------- #
# 4. one model raises Exception → that response filtered, others returned
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_one_failing_model_filtered():
    mocks = []
    for i in range(4):
        m = MagicMock()
        m.model_name = f"model-{i}"
        if i == 2:

            async def boom(messages: Any, idx: int = i) -> Any:
                raise RuntimeError(f"model {idx} failed")

            m.ainvoke = boom
        else:

            async def ok(messages: Any, content: str = _VALID_CRITIC_JSON) -> MagicMock:
                r = MagicMock()
                r.content = content
                return r

            m.ainvoke = ok
        mocks.append(m)

    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    # 3 successes, 1 filtered
    assert len(result["critic_responses"]) == 3
    reviewer_models = {cr["reviewer_model"] for cr in result["critic_responses"]}
    assert "model-2" not in reviewer_models


# --------------------------------------------------------------------------- #
# 5. push_job_progress called when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_calls_push_job_progress_with_job_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("app.graph.nodes.critic.push_job_progress", push_mock)

    mocks = _make_four_critics()
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)
    state["job_id"] = "job-xyz"

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        await critic_node(state)

    push_mock.assert_awaited_once()
    assert push_mock.await_args is not None
    args = push_mock.await_args[0]
    assert args[0] == "job-xyz"
    assert args[1]["step"] == "critic"


# --------------------------------------------------------------------------- #
# 6. _collect_quality_gaps is called — quality_gaps propagated to council_responses
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_quality_gaps_propagated_to_council_responses():
    # All 4 models flag "output_format" — consensus gap (≥ threshold)
    json_with_gap = (
        '{"ranking": ["A", "B", "C"], "ranking_rationale": "ok",'
        ' "critiques": {}, "quality_gaps": ["output_format"]}'
    )
    mocks = _make_four_critics(json_with_gap)
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    # Every council proposal should carry _quality_gaps
    for proposal in result["council_responses"]:
        assert "_quality_gaps" in proposal


# --------------------------------------------------------------------------- #
# 7. council_responses get _quality_gaps attached if any gaps found
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_attaches_quality_gaps_to_proposals():
    json_with_gap = (
        '{"ranking": ["A", "B", "C"], "ranking_rationale": "ok",'
        ' "critiques": {}, "quality_gaps": ["role_persona"]}'
    )
    mocks = _make_four_critics(json_with_gap)
    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = copy.deepcopy(_FOUR_PROPOSALS)

    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    for proposal in result["council_responses"]:
        assert isinstance(proposal["_quality_gaps"], list)
        assert "role_persona" in proposal["_quality_gaps"]


# --------------------------------------------------------------------------- #
# Early-exit path also calls push_job_progress when job_id is set
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_critic_early_exit_with_job_id_calls_push(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    push_mock = AsyncMock()
    monkeypatch.setattr("app.graph.nodes.critic.push_job_progress", push_mock)

    state = copy.deepcopy(_BASE_STATE)
    state["council_responses"] = _FOUR_PROPOSALS[:2]  # only 2 proposals
    state["job_id"] = "job-early"

    mocks = _make_four_critics()
    with patch.object(critic_module, "_get_critic_models", return_value=mocks):
        result = await critic_node(state)

    assert result == {"critic_responses": []}
    push_mock.assert_awaited_once()
