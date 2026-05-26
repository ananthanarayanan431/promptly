from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.rate_limit import get_rate_limit_settings
from app.core.middleware import RateLimitMiddleware


def _make_app_with_middleware() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware)

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/ready")
    async def ready() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/users/me")
    async def me() -> dict[str, str]:
        return {"id": "1"}

    return app


@pytest.fixture
def mock_redis_under_limit() -> MagicMock:
    mock_pipe = MagicMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis


@pytest.fixture
def mock_redis_over_limit() -> MagicMock:
    mock_pipe = MagicMock()
    mock_pipe.execute = AsyncMock(return_value=[200, True])
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis


def test_health_endpoint_bypasses_rate_limit(mock_redis_over_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch(
        "app.core.middleware.get_redis_client", AsyncMock(return_value=mock_redis_over_limit)
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/v1/health")
    assert response.status_code == 200


def test_ready_endpoint_bypasses_rate_limit(mock_redis_over_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch(
        "app.core.middleware.get_redis_client", AsyncMock(return_value=mock_redis_over_limit)
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/v1/ready")
    assert response.status_code == 200


def test_normal_route_passes_under_global_limit(mock_redis_under_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch(
        "app.core.middleware.get_redis_client", AsyncMock(return_value=mock_redis_under_limit)
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/v1/users/me")
    assert response.status_code == 200
    expected_limit = str(get_rate_limit_settings().RATE_LIMIT_REQUESTS)
    assert response.headers["X-RateLimit-Limit"] == expected_limit
    assert "X-RateLimit-Remaining" in response.headers
