"""Integration tests for users and templates endpoints."""

from __future__ import annotations

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()


async def _make_user_headers(client: AsyncClient) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


# ── Users ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_returns_user(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
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
async def test_get_credits(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/users/credits", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["credits"] == 100


@pytest.mark.asyncio
async def test_add_credits(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post("/api/v1/users/credits/add", json={"amount": 50}, headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["credits"] == 150


@pytest.mark.asyncio
async def test_add_credits_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/users/credits/add", json={"amount": 50})
    assert res.status_code == 401


# ── Templates ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_templates(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/templates", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "categories" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_list_templates_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/templates")
    assert res.status_code == 401
