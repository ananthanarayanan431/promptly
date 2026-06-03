from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_chat_deducts_10_credits(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user(credits=100)
    with patch("app.optimize.api.router.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert res.status_code == 202
    await db_session.refresh(user)
    assert user.credits == 90


@pytest.mark.asyncio
async def test_chat_returns_402_with_zero_credits(client: AsyncClient, make_user) -> None:
    _, headers = await make_user(credits=0)
    res = await client.post(
        "/api/v1/chat/",
        json={"prompt": "You are a helpful assistant."},
        headers=headers,
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_bridge_transfer_deducts_5_credits(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user(credits=100)
    with patch("app.prompt_bridge.api.router.run_prompt_transfer") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/prompt-bridge/transfer",
            json={
                "source_prompt": "You are a helpful assistant.",
                "source_model": "openai/gpt-4o",
                "target_model": "anthropic/claude-3-5-sonnet",
            },
            headers=headers,
        )
    assert res.status_code == 202
    await db_session.refresh(user)
    assert user.credits == 95


@pytest.mark.asyncio
async def test_bridge_transfer_returns_402_with_zero_credits(
    client: AsyncClient, make_user
) -> None:
    _, headers = await make_user(credits=0)
    res = await client.post(
        "/api/v1/prompt-bridge/transfer",
        json={
            "source_prompt": "You are a helpful assistant.",
            "source_model": "openai/gpt-4o",
            "target_model": "anthropic/claude-3-5-sonnet",
        },
        headers=headers,
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_bridge_transfer_returns_402_with_insufficient_credits(
    client: AsyncClient, make_user
) -> None:
    _, headers = await make_user(credits=4)
    res = await client.post(
        "/api/v1/prompt-bridge/transfer",
        json={
            "source_prompt": "You are a helpful assistant.",
            "source_model": "openai/gpt-4o",
            "target_model": "anthropic/claude-3-5-sonnet",
        },
        headers=headers,
    )
    assert res.status_code == 402
