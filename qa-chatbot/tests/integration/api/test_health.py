"""Integration tests for health and readiness endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.app import get_app_settings


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient) -> None:
    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "ok"
    assert res.json()["data"]["version"] == get_app_settings().APP_VERSION


@pytest.mark.asyncio
async def test_ready_endpoint_with_db(client: AsyncClient, db_session: AsyncSession) -> None:
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)
    with (
        patch("app.api.v1.health.get_redis_client", return_value=mock_redis),
        patch("app.api.v1.health._check_supabase", AsyncMock(return_value="ok")),
    ):
        res = await client.get("/api/v1/ready")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["checks"]["postgres"] == "ok"
    assert data["checks"]["supabase"] == "ok"


@pytest.mark.asyncio
async def test_ready_endpoint_redis_failure(client: AsyncClient, db_session: AsyncSession) -> None:
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=Exception("Connection refused"))
    with (
        patch("app.api.v1.health.get_redis_client", return_value=mock_redis),
        patch("app.api.v1.health._check_supabase", AsyncMock(return_value="ok")),
    ):
        res = await client.get("/api/v1/ready")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["status"] == "degraded"
    assert "error" in data["checks"]["redis"]


@pytest.mark.asyncio
async def test_ready_endpoint_supabase_failure(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)
    with (
        patch("app.api.v1.health.get_redis_client", return_value=mock_redis),
        patch(
            "app.api.v1.health._check_supabase",
            AsyncMock(side_effect=Exception("unreachable")),
        ),
    ):
        res = await client.get("/api/v1/ready")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["status"] == "degraded"
    assert "error" in data["checks"]["supabase"]
