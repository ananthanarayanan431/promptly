import uuid
from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from faker import Faker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_category import PromptCategory
from app.models.user import User

fake = Faker()

# Factory signature: (*, email=None, credits=100) -> (User, auth-headers dict)
MakeUser = Callable[..., Awaitable[tuple[User, dict[str, str]]]]


@pytest_asyncio.fixture
async def make_user(db_session: AsyncSession) -> MakeUser:
    """Factory fixture: create a User row and return (user, auth headers).

    The headers carry ``X-Test-User-Id``, which the test-only get_current_user
    override in the root conftest resolves back to this user (loading live
    credits/email from the DB). Call multiple times for multi-user tests.
    """

    async def _make(*, email: str | None = None, credits: int = 100) -> tuple[User, dict[str, str]]:
        user = User(
            email=email or fake.unique.email(),
            clerk_user_id=f"user_{uuid.uuid4().hex}",
            credits=credits,
        )
        db_session.add(user)
        await db_session.flush()
        await db_session.refresh(user)
        return user, {"X-Test-User-Id": str(user.id)}

    return _make


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
