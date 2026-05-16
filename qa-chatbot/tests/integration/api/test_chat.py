import uuid
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import set_job_owner, set_job_result, set_job_status
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


async def _make_user_with_credits(
    client: AsyncClient, db: AsyncSession, credits: int = 100
) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    reg = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    user_id = reg.json()["data"]["id"]  # noqa: F841

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = credits
    await db.flush()

    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_submit_chat_returns_job_id(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_with_credits(client, db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert res.status_code == 202
    data = res.json()["data"]
    assert "job_id" in data
    assert "session_id" in data


@pytest.mark.asyncio
async def test_submit_chat_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/chat/", json={"prompt": "hello"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_poll_job_known_id(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_with_credits(client, db_session)

    # Get the user id from /me so we can seed job ownership
    me = await client.get("/api/v1/users/me", headers=headers)
    user_id = me.json()["data"]["id"]

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "completed")
    await set_job_owner(job_id, user_id)
    await set_job_result(
        job_id,
        {
            "session_id": str(uuid.uuid4()),
            "original_prompt": "You are a helpful assistant.",
            "optimized_prompt": "Better prompt.",
            "token_usage": {},
        },
    )

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_poll_job_unknown_id(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_with_credits(client, db_session)
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_unauthenticated(client: AsyncClient) -> None:
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}")
    assert res.status_code == 401
