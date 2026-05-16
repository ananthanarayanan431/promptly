"""Integration tests for prompt analysis endpoints: health-score, advisory, diff."""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

fake = Faker()

_TEST_PROMPT = "You are a helpful assistant. Answer questions clearly and concisely."

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
    "top_improvements": ["Add context"],
    "deploy_verdict": "Ready",
    "overall_score": 7.5,
}

_ADVISORY_JSON: dict[str, Any] = {
    "meta": {
        "overall_score": "MODERATE",
        "injection_risk": "low",
        "dimensions_evaluated": ["role_and_persona", "task_clarity"],
    },
    "strengths": ["Clear role definition"],
    "weaknesses": ["Could be more specific"],
    "improvements": ["Add domain context"],
    "overall_assessment": "Good baseline prompt",
}


async def _make_user_headers(client: AsyncClient) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _make_analyser_mock(content: str) -> MagicMock:
    mock = MagicMock()
    resp = MagicMock()
    resp.content = content
    mock.ainvoke = AsyncMock(return_value=resp)
    return mock


@pytest.mark.asyncio
async def test_health_score_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/prompts/health-score", json={"prompt": _TEST_PROMPT})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_health_score_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    res = await client.post(
        "/api/v1/prompts/health-score", json={"prompt": _TEST_PROMPT}, headers=headers
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_health_score_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    mock = _make_analyser_mock(json.dumps(_HEALTH_SCORE_JSON))

    with (
        patch("app.services.prompt_service._get_analyser", return_value=mock),
        patch(
            "app.services.prompt_service.guardrails_node",
            new=AsyncMock(return_value={"error": None}),
        ),
    ):
        res = await client.post(
            "/api/v1/prompts/health-score", json={"prompt": _TEST_PROMPT}, headers=headers
        )

    assert res.status_code == 200
    data = res.json()["data"]
    assert data["meta"]["overall_score"] == 7.5
    assert "scores" in data


@pytest.mark.asyncio
async def test_advisory_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/prompts/advisory", json={"prompt": _TEST_PROMPT})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_advisory_insufficient_credits(client: AsyncClient, db_session: AsyncSession) -> None:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    res = await client.post(
        "/api/v1/prompts/advisory", json={"prompt": _TEST_PROMPT}, headers=headers
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_advisory_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    mock = _make_analyser_mock(json.dumps(_ADVISORY_JSON))

    with (
        patch("app.services.prompt_service._get_analyser", return_value=mock),
        patch(
            "app.services.prompt_service.guardrails_node",
            new=AsyncMock(return_value={"error": None}),
        ),
    ):
        res = await client.post(
            "/api/v1/prompts/advisory", json={"prompt": _TEST_PROMPT}, headers=headers
        )

    assert res.status_code == 200
    data = res.json()["data"]
    assert "strengths" in data
    assert "weaknesses" in data


@pytest.mark.asyncio
async def test_diff_not_found_returns_404(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(
        f"/api/v1/prompts/versions/{uuid.uuid4()!s}/diff?from=1&to=2", headers=headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_diff_returns_hunks(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)

    # Create a prompt family with two versions
    res = await client.post(
        "/api/v1/prompts/versions",
        json={"name": "DIFF TEST", "prompt": "You are a helpful assistant."},
        headers=headers,
    )
    assert res.status_code == 200
    prompt_id = res.json()["data"]["prompt_id"]

    # Create a second version by using the prompt_id in chat
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        await client.post(
            "/api/v1/chat/",
            json={"prompt_id": prompt_id},
            headers=headers,
        )

    # Get the second version manually
    from sqlalchemy import select

    from app.models.prompt_version import PromptVersion

    await db_session.execute(
        select(PromptVersion).where(PromptVersion.prompt_id == uuid.UUID(prompt_id))
    )

    # Just test with v1 to v1 (same content — equal hunks)
    res = await client.get(
        f"/api/v1/prompts/versions/{prompt_id}/diff?from=1&to=1", headers=headers
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert "hunks" in data
    assert "stats" in data


@pytest.mark.asyncio
async def test_list_prompt_families_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/prompts/versions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 0
    assert data["families"] == []


@pytest.mark.asyncio
async def test_list_prompt_families_after_create(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    await client.post(
        "/api/v1/prompts/versions",
        json={"name": "FAMILY TEST", "prompt": "You are a helpful assistant."},
        headers=headers,
    )

    res = await client.get("/api/v1/prompts/versions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert len(data["families"]) == 1
    assert data["families"][0]["name"] == "FAMILY TEST"
