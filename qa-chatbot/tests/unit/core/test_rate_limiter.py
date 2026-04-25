from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import Request

from app.core.rate_limit import RateLimiter
from app.models.user import User


def _make_request(path: str = "/api/v1/chat/") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "query_string": b"",
        "headers": [],
    }
    return Request(scope)


def _make_user() -> User:
    return User(id=uuid4(), email="test@test.com", credits=100, is_active=True)


def _make_redis_mock(execute_return: list[int]) -> tuple[MagicMock, MagicMock]:
    """Return (mock_redis, mock_pipe) wired up with the given execute return value."""
    mock_pipe = MagicMock()
    mock_pipe.incr = MagicMock()
    mock_pipe.expire = MagicMock()
    mock_pipe.execute = AsyncMock(return_value=execute_return)
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis, mock_pipe


@pytest.mark.asyncio
async def test_rate_limiter_passes_under_limit() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_redis, _ = _make_redis_mock([5, True])

    with patch("app.core.rate_limit.get_redis_client", AsyncMock(return_value=mock_redis)):
        # Should not raise
        await limiter(request, user)


@pytest.mark.asyncio
async def test_rate_limiter_raises_429_at_limit() -> None:
    from fastapi import HTTPException

    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_redis, _ = _make_redis_mock([11, True])

    with patch("app.core.rate_limit.get_redis_client", AsyncMock(return_value=mock_redis)):
        with pytest.raises(HTTPException) as exc_info:
            await limiter(request, user)

    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers


@pytest.mark.asyncio
async def test_rate_limiter_uses_user_id_as_key() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_redis, mock_pipe = _make_redis_mock([1, True])

    with patch("app.core.rate_limit.get_redis_client", AsyncMock(return_value=mock_redis)):
        await limiter(request, user)

    # Verify the pipeline was called with the correct key
    mock_pipe.incr.assert_called_once()
    key_used = mock_pipe.incr.call_args[0][0]
    assert str(user.id) in key_used
    assert "/api/v1/chat/" in key_used


@pytest.mark.asyncio
async def test_rate_limiter_exactly_at_limit_passes() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_redis, _ = _make_redis_mock([10, True])

    with patch("app.core.rate_limit.get_redis_client", AsyncMock(return_value=mock_redis)):
        # Exactly at limit should still pass (> not >=)
        await limiter(request, user)
