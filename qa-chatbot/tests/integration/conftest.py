from collections.abc import AsyncGenerator

import pytest_asyncio
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

fake = Faker()


@pytest_asyncio.fixture
async def auth_headers(
    client: AsyncClient, db_session: AsyncSession
) -> AsyncGenerator[dict[str, str], None]:
    """Register a fresh user, log in, yield auth headers, then delete the user."""
    email = fake.unique.email()
    password = "TestPass123!"  # noqa: S105

    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    assert reg.status_code == 200, reg.text

    login = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["data"]["access_token"]

    yield {"Authorization": f"Bearer {token}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        await db_session.delete(user)
        await db_session.commit()
