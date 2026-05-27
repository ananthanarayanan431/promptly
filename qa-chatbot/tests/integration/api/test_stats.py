"""Integration tests for the stats API endpoint."""

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.models.session import ChatSession

_METRIC = {"score": 7, "rationale": "Good"}
_HEALTH_SCORE_JSON: dict[str, Any] = {
    "meta": {
        "overall_score": 7.5,
        "grade": "B",
        "deploy_ready": True,
        "injection_risk": "low",
    },
    "scores": {
        "clarity": _METRIC,
        "specificity": _METRIC,
        "completeness": _METRIC,
        "conciseness": _METRIC,
        "tone": _METRIC,
        "actionability": _METRIC,
        "context_richness": _METRIC,
        "goal_alignment": _METRIC,
        "injection_robustness": _METRIC,
        "reusability": _METRIC,
    },
    "critical_failures": [],
    "top_improvements": [],
    "deploy_verdict": "Ready",
}


@pytest.mark.asyncio
async def test_dashboard_stats_empty_user(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["prompts_optimized"] == 0
    assert data["total_sessions"] == 0
    assert data["total_tokens"] == 0
    assert data["estimated_cost_usd"] == 0.0
    assert "daily_activity" in data
    assert "usage" in data
    assert "model_breakdown" in data
    assert "quality_trend" in data


@pytest.mark.asyncio
async def test_dashboard_stats_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/stats")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_dashboard_stats_credits_reflected(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    # New user starts with 100 credits
    assert data["credits_remaining"] == 100


@pytest.mark.asyncio
async def test_dashboard_stats_streak_days_zero_for_new_user(
    client: AsyncClient, make_user
) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["streak_days"] == 0


@pytest.mark.asyncio
async def test_dashboard_stats_usage_reflected_after_health_score(
    client: AsyncClient, make_user
) -> None:
    """health_score and advisory actions appear in usage.all_time."""
    _, headers = await make_user()

    mock = MagicMock()
    resp = MagicMock()
    resp.content = json.dumps(_HEALTH_SCORE_JSON)
    mock.ainvoke = AsyncMock(return_value=resp)

    with (
        patch("app.services.prompt_service._get_analyser", return_value=mock),
        patch(
            "app.services.prompt_service.guardrails_node",
            new=AsyncMock(return_value={"error": None}),
        ),
    ):
        hs_res = await client.post(
            "/api/v1/prompts/health-score",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert hs_res.status_code == 200

    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    usage = res.json()["data"]["usage"]["all_time"]
    assert usage["health_score_calls"] == 1
    assert usage["health_score_credits"] == 5


@pytest.mark.asyncio
async def test_dashboard_stats_versions_saved_reflected(client: AsyncClient, make_user) -> None:
    """Creating a prompt version increments versions_saved in stats."""
    _, headers = await make_user()

    await client.post(
        "/api/v1/prompts/versions",
        json={"name": "STATS TEST", "prompt": "You are a helpful assistant."},
        headers=headers,
    )

    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["versions_saved"] >= 1
    assert data["total_versions"] >= 1


@pytest.mark.asyncio
async def test_dashboard_stats_daily_activity_has_30_days(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    daily = res.json()["data"]["daily_activity"]
    assert len(daily) == 30


@pytest.mark.asyncio
async def test_dashboard_stats_with_messages_counts_optimized(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    """Messages with a response count toward prompts_optimized."""
    user, headers = await make_user()

    # Create a session and message directly in DB
    session = ChatSession(user_id=user.id, title="Test", graph_thread_id="test-thread-001")
    db_session.add(session)
    await db_session.flush()

    msg = Message(
        session_id=session.id,
        role="user",
        raw_prompt="You are a helpful assistant.",
        response="Optimized prompt.",
        token_usage={"total_tokens": 100},
        council_votes=[{"model": "openai/gpt-4o-mini", "usage": {"total_tokens": 100}}],
    )
    db_session.add(msg)
    await db_session.flush()

    res = await client.get("/api/v1/stats", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["prompts_optimized"] == 1
    assert data["total_sessions"] == 1
    assert data["total_tokens"] == 100
    assert len(data["model_breakdown"]) == 1
