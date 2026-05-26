"""Integration tests for users and templates endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

# ── Users ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_returns_user(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "id" in data
    assert "email" in data


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_credits(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/users/credits", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["credits"] == 100


@pytest.mark.asyncio
async def test_add_credits(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.post("/api/v1/users/credits/add", json={"amount": 50}, headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["credits"] == 150


@pytest.mark.asyncio
async def test_add_credits_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/users/credits/add", json={"amount": 50})
    assert res.status_code == 401


# ── Templates ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_templates(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/templates", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "categories" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_list_templates_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/templates")
    assert res.status_code == 401
