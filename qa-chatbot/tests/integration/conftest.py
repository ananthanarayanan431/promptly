from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

fake = Faker()


@pytest.fixture(autouse=True)
def mock_rate_limit_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the middleware Redis client so rate-limit counters never trigger 429."""
    mock_pipe = MagicMock()
    mock_pipe.incr = MagicMock()
    mock_pipe.expire = MagicMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    monkeypatch.setattr(
        "app.core.middleware.get_redis_client",
        AsyncMock(return_value=mock_redis),
    )


@pytest.fixture(autouse=True)
def mock_cache_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch get_redis_client used by core/cache and prompt_bridge/cache so Redis ops are no-ops.

    Uses an in-memory dict so set/get round-trips work correctly for job-tracking tests.
    """
    _store: dict[str, str] = {}

    async def _set(key: str, value: str, ex: int | None = None) -> bool:  # noqa: ANN001
        _store[key] = value
        return True

    async def _get(key: str) -> str | None:
        return _store.get(key)

    async def _setex(key: str, ttl: int, value: str) -> bool:  # noqa: ANN001
        _store[key] = value
        return True

    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(side_effect=_set)
    mock_redis.get = AsyncMock(side_effect=_get)
    mock_redis.setex = AsyncMock(side_effect=_setex)
    monkeypatch.setattr("app.db.redis.get_redis_client", AsyncMock(return_value=mock_redis))
    monkeypatch.setattr("app.core.cache.get_redis_client", AsyncMock(return_value=mock_redis))
    monkeypatch.setattr(
        "app.prompt_bridge.infrastructure.cache.get_redis_client",
        AsyncMock(return_value=mock_redis),
    )


@pytest_asyncio.fixture(loop_scope="session")
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
