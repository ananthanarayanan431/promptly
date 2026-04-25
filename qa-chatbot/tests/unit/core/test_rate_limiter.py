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


@pytest.mark.asyncio
async def test_rate_limiter_passes_under_limit() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[5, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        # Should not raise
        await limiter(request, user)


@pytest.mark.asyncio
async def test_rate_limiter_raises_429_at_limit() -> None:
    from fastapi import HTTPException

    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[11, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        with pytest.raises(HTTPException) as exc_info:
            await limiter(request, user)

    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers


@pytest.mark.asyncio
async def test_rate_limiter_uses_user_id_as_key() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    captured_keys: list[str] = []

    async def fake_incr(key: str) -> None:
        captured_keys.append(key)

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        await limiter(request, user)

    # Verify the pipeline was called (key is set inside pipeline)
    mock_pipe.incr.assert_called_once()
    key_used = mock_pipe.incr.call_args[0][0]
    assert str(user.id) in key_used
    assert "/api/v1/chat/" in key_used


@pytest.mark.asyncio
async def test_rate_limiter_exactly_at_limit_passes() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[10, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        # Exactly at limit should still pass (> not >=)
        await limiter(request, user)
