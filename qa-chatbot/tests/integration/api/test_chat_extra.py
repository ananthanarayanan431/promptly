"""Integration tests for remaining chat API paths: suggest-name, save-version, prompt_id."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()


async def _make_user_headers(client: AsyncClient, db: AsyncSession) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _mock_naming_llm(name: str = "TEST PROMPT") -> MagicMock:
    mock = MagicMock()
    resp = MagicMock()
    resp.content = name
    mock.ainvoke = AsyncMock(return_value=resp)
    return mock


@pytest.mark.asyncio
async def test_suggest_name_returns_name(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client, db_session)
    with patch("app.api.v1.chat.build_naming_llm", return_value=_mock_naming_llm("CODE REVIEWER")):
        res = await client.post(
            "/api/v1/chat/suggest-name",
            json={"prompt": "You are a code review assistant. Review pull requests."},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["data"]["name"] == "CODE REVIEWER"


@pytest.mark.asyncio
async def test_suggest_name_unauthenticated(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/chat/suggest-name",
        json={"prompt": "You are a helpful assistant."},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_suggest_name_timeout_raises_503(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=TimeoutError)
    with patch("app.api.v1.chat.build_naming_llm", return_value=mock_llm):
        res = await client.post(
            "/api/v1/chat/suggest-name",
            json={"prompt": "You are a helpful assistant. Answer questions clearly."},
            headers=headers,
        )
    assert res.status_code == 504


@pytest.mark.asyncio
async def test_save_version_creates_prompt_family(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    with patch("app.api.v1.chat.build_naming_llm", return_value=_mock_naming_llm("EMAIL WRITER")):
        res = await client.post(
            "/api/v1/chat/save-version",
            json={
                "original_prompt": "You are an email assistant. Write professional emails.",
                "optimized_prompt": (
                    "You are a senior email strategist." " Draft concise, impactful emails."
                ),
            },
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()["data"]
    assert "prompt_id" in data
    assert data["version"] == 2
    assert data["name"] == "EMAIL WRITER"


@pytest.mark.asyncio
async def test_save_version_unauthenticated(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/chat/save-version",
        json={
            "original_prompt": "You are a helpful assistant.",
            "optimized_prompt": "You are an expert assistant.",
        },
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_save_version_timeout_raises_503(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=TimeoutError)
    with patch("app.api.v1.chat.build_naming_llm", return_value=mock_llm):
        res = await client.post(
            "/api/v1/chat/save-version",
            json={
                "original_prompt": (
                    "You are a helpful assistant." " Answer questions clearly and concisely."
                ),
                "optimized_prompt": "You are an expert assistant. Provide detailed answers.",
            },
            headers=headers,
        )
    assert res.status_code == 504


@pytest.mark.asyncio
async def test_create_chat_with_prompt_id(client: AsyncClient, db_session: AsyncSession) -> None:
    """Using prompt_id to look up the latest version and submit for optimization."""
    headers = await _make_user_headers(client, db_session)

    # First create a prompt version
    with patch("app.api.v1.chat.build_naming_llm", return_value=_mock_naming_llm("MY PROMPT")):
        save_res = await client.post(
            "/api/v1/chat/save-version",
            json={
                "original_prompt": "You are a helpful assistant. Answer questions concisely.",
                "optimized_prompt": "You are an expert assistant. Answer questions with depth.",
            },
            headers=headers,
        )
    prompt_id = save_res.json()["data"]["prompt_id"]

    # Submit optimization using prompt_id
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt_id": prompt_id},
            headers=headers,
        )
    assert res.status_code == 202
    assert res.json()["data"]["prompt_id"] == prompt_id


@pytest.mark.asyncio
async def test_create_chat_with_invalid_prompt_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Passing a prompt_id that doesn't exist should return 404."""
    headers = await _make_user_headers(client, db_session)
    res = await client.post(
        "/api/v1/chat/",
        json={"prompt_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_create_chat_celery_failure_refunds_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """If Celery dispatch raises, credits are refunded and 503 returned."""
    from sqlalchemy import select

    from app.models.user import User

    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    initial_credits = user.credits

    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.side_effect = RuntimeError("Celery down")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant. Answer questions clearly."},
            headers=headers,
        )

    assert res.status_code == 504

    # Credits should be refunded — user back to initial amount
    await db_session.refresh(user)
    assert user.credits == initial_credits


@pytest.mark.asyncio
async def test_create_chat_with_category_slug(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={
                "prompt": "You are a helpful assistant. Answer questions clearly.",
                "category_slug": "general",
            },
            headers=headers,
        )
    assert res.status_code == 202


@pytest.mark.asyncio
async def test_create_chat_with_invalid_category_slug(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    res = await client.post(
        "/api/v1/chat/",
        json={
            "prompt": "You are a helpful assistant.",
            "category_slug": "nonexistent-slug-xyz",
        },
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_chat_with_name_and_feedback(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client, db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={
                "prompt": "You are a helpful assistant. Answer questions clearly.",
                "name": "TEST PROMPT FAMILY",
                "feedback": "Make it more concise",
            },
            headers=headers,
        )
    assert res.status_code == 202


@pytest.mark.asyncio
async def test_grouped_sessions_structure(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client, db_session)
    res = await client.get("/api/v1/chat/sessions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "today" in data
    assert "last_7_days" in data
    assert "last_30_days" in data
    assert "older" in data


@pytest.mark.asyncio
async def test_recent_sessions_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client, db_session)
    res = await client.get("/api/v1/chat/sessions/recent", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["sessions"] == []
