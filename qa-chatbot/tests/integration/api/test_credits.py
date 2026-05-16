from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_category import PromptCategory
from app.models.user import User

fake = Faker()


@pytest_asyncio.fixture(autouse=True)
async def seed_general_category(db_session: AsyncSession) -> None:
    """Insert the 'general' predefined category so POST /chat/ resolves it."""
    existing = await db_session.execute(
        select(PromptCategory).where(PromptCategory.slug == "general")
    )
    if existing.scalar_one_or_none() is None:
        db_session.add(
            PromptCategory(
                user_id=None,
                slug="general",
                name="General",
                description="Default category.",
                is_predefined=True,
            )
        )
        await db_session.flush()


async def _register_and_login(
    client: AsyncClient, credits: int, db: AsyncSession
) -> tuple[dict[str, str], User]:
    """Register a user, set their credits, and return auth headers + user ORM object."""
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = credits
    await db.flush()

    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}, user


@pytest.mark.asyncio
async def test_chat_deducts_10_credits(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await _register_and_login(client, credits=100, db=db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
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
async def test_chat_returns_402_with_zero_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=0, db=db_session)
    res = await client.post(
        "/api/v1/chat/",
        json={"prompt": "You are a helpful assistant."},
        headers=headers,
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_bridge_transfer_deducts_5_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, user = await _register_and_login(client, credits=100, db=db_session)
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
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=0, db=db_session)
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
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=4, db=db_session)
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
