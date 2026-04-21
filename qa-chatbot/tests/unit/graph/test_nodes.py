import asyncio
from unittest.mock import MagicMock, patch


def test_council_vote_all_models_receive_same_system_prompt():
    """All council models must receive the identical system prompt."""
    from app.graph.nodes import council_vote

    calls: list[list] = []

    async def fake_ainvoke(messages):
        calls.append(messages)
        mock_resp = MagicMock()
        mock_resp.content = "optimized"
        mock_resp.usage_metadata = {}
        return mock_resp

    fake_models = [MagicMock() for _ in range(4)]
    for m in fake_models:
        m.ainvoke = fake_ainvoke
        m.model_name = "test-model"

    state = {
        "raw_prompt": "Write me a haiku",
        "feedback": None,
        "job_id": None,
        "session_id": "",
        "user_id": "u1",
        "intent": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "messages": [],
        "token_usage": {},
        "error": None,
    }

    with patch.object(council_vote, "_get_council_models", return_value=fake_models):
        result = asyncio.run(council_vote.council_vote_node(state))

    assert len(calls) == 4
    system_prompts = [c[0]["content"] for c in calls]
    n_unique = len(set(system_prompts))
    assert (
        n_unique == 1
    ), f"Expected all models to receive the same prompt, got {n_unique} different prompts"
    assert system_prompts[0] == council_vote._COUNCIL_PROMPT
    assert len(result["council_responses"]) == 4


def test_council_vote_no_strategy_function_exists():
    """The old _get_strategy selector must not exist."""
    from app.graph.nodes import council_vote

    assert not hasattr(
        council_vote, "_get_strategy"
    ), "_get_strategy should have been removed; all models now receive the same prompt"
