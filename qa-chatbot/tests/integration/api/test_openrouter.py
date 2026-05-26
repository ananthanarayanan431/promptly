"""Integration tests for the openrouter proxy endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, Response

_FAKE_MODELS_RESPONSE = {
    "data": [
        {
            "id": "openai/gpt-4o",
            "name": "GPT-4o",
            "context_length": 128000,
            "architecture": {"modality": "text", "output_modalities": ["text"]},
            "pricing": {"prompt": "0.000005", "completion": "0.000015"},
        },
        {
            "id": "anthropic/claude-3-5-haiku",
            "name": "Claude 3.5 Haiku",
            "context_length": 200000,
            "architecture": {"modality": "text", "output_modalities": ["text"]},
            "pricing": {"prompt": "0.000001", "completion": "0.000005"},
        },
    ]
}

_FAKE_KEY_INFO = {
    "label": "test-key",
    "usage": 0.5,
    "usage_daily": 0.05,
    "usage_weekly": 0.1,
    "usage_monthly": 0.3,
    "limit": None,
    "is_free_tier": False,
}


@pytest.mark.asyncio
async def test_get_models_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/openrouter/models")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_models_returns_list(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    mock_http_resp = MagicMock(spec=Response)
    mock_http_resp.status_code = 200
    mock_http_resp.json.return_value = _FAKE_MODELS_RESPONSE

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_http_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    # Reset module-level cache
    import app.api.v1.openrouter as openrouter_mod

    openrouter_mod._models_cache = []
    openrouter_mod._models_cache_ts = 0.0

    with patch("app.api.v1.openrouter.httpx.AsyncClient", return_value=mock_client):
        res = await client.get("/api/v1/openrouter/models", headers=headers)

    assert res.status_code == 200
    data = res.json()["data"]
    assert "models" in data
    assert len(data["models"]) == 2
    assert data["cached"] is False


@pytest.mark.asyncio
async def test_get_models_returns_cached(client: AsyncClient, make_user) -> None:
    """Second call within TTL returns cached=True without making HTTP request."""
    _, headers = await make_user()

    mock_http_resp = MagicMock(spec=Response)
    mock_http_resp.status_code = 200
    mock_http_resp.json.return_value = _FAKE_MODELS_RESPONSE

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_http_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    import app.api.v1.openrouter as openrouter_mod

    openrouter_mod._models_cache = []
    openrouter_mod._models_cache_ts = 0.0

    with patch("app.api.v1.openrouter.httpx.AsyncClient", return_value=mock_client):
        await client.get("/api/v1/openrouter/models", headers=headers)
        res2 = await client.get("/api/v1/openrouter/models", headers=headers)

    assert res2.json()["data"]["cached"] is True


@pytest.mark.asyncio
async def test_get_models_http_error_returns_502(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    mock_http_resp = MagicMock(spec=Response)
    mock_http_resp.status_code = 503
    mock_http_resp.text = "Service Unavailable"

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_http_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    import app.api.v1.openrouter as openrouter_mod

    openrouter_mod._models_cache = []
    openrouter_mod._models_cache_ts = 0.0

    with patch("app.api.v1.openrouter.httpx.AsyncClient", return_value=mock_client):
        res = await client.get("/api/v1/openrouter/models", headers=headers)

    assert res.status_code == 502


@pytest.mark.asyncio
async def test_get_openrouter_stats_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/openrouter/stats")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_openrouter_stats_returns_data(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    mock_http_resp = MagicMock(spec=Response)
    mock_http_resp.status_code = 200
    mock_http_resp.json.return_value = {"data": _FAKE_KEY_INFO}

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_http_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.api.v1.openrouter.httpx.AsyncClient", return_value=mock_client):
        res = await client.get("/api/v1/openrouter/stats", headers=headers)

    assert res.status_code == 200
    data = res.json()["data"]
    assert "key" in data
    assert "top_models" in data
    assert data["key"]["label"] == "test-key"


@pytest.mark.asyncio
async def test_get_openrouter_stats_502_on_api_error(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    mock_http_resp = MagicMock(spec=Response)
    mock_http_resp.status_code = 401
    mock_http_resp.text = "Unauthorized"

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_http_resp
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.api.v1.openrouter.httpx.AsyncClient", return_value=mock_client):
        res = await client.get("/api/v1/openrouter/stats", headers=headers)

    assert res.status_code == 502
