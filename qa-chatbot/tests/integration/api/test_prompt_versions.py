"""Integration tests for the prompts versioning API endpoints."""

import uuid

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()


async def _make_user(client: AsyncClient, db: AsyncSession) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_prompt_families_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user(client, db_session)
    res = await client.get("/api/v1/prompts/versions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["families"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_prompt_families_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/prompts/versions")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_prompt_version(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user(client, db_session)
    res = await client.post(
        "/api/v1/prompts/versions",
        json={"name": "MY TEST PROMPT", "prompt": "You are a helpful assistant."},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert "prompt_id" in data
    assert "version" in data
    assert data["version"]["version"] == 1
    assert data["version"]["name"] == "MY TEST PROMPT"


@pytest.mark.asyncio
async def test_create_prompt_version_unauthenticated(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/prompts/versions",
        json={"name": "TEST", "prompt": "Some prompt"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_list_prompt_versions_after_create(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user(client, db_session)
    create_res = await client.post(
        "/api/v1/prompts/versions",
        json={"name": "MY VERSIONED PROMPT", "prompt": "Initial prompt v1."},
        headers=headers,
    )
    prompt_id = create_res.json()["data"]["prompt_id"]

    res = await client.get(f"/api/v1/prompts/versions/{prompt_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "versions" in data
    assert len(data["versions"]) >= 1
    assert data["versions"][0]["version"] == 1


@pytest.mark.asyncio
async def test_list_prompt_versions_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user(client, db_session)
    res = await client.get(f"/api/v1/prompts/versions/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_list_families_after_create(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user(client, db_session)
    await client.post(
        "/api/v1/prompts/versions",
        json={"name": "FAMILY TEST", "prompt": "Prompt content."},
        headers=headers,
    )
    res = await client.get("/api/v1/prompts/versions", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] >= 1
    names = [f["name"] for f in data["families"]]
    assert "FAMILY TEST" in names


@pytest.mark.asyncio
async def test_create_prompt_version_isolation_between_users(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """User A's prompts are not visible to user B."""
    headers_a = await _make_user(client, db_session)
    headers_b = await _make_user(client, db_session)

    create_res = await client.post(
        "/api/v1/prompts/versions",
        json={"name": "USER A PROMPT", "prompt": "Private prompt."},
        headers=headers_a,
    )
    prompt_id = create_res.json()["data"]["prompt_id"]

    # User B cannot access User A's prompt — 404
    res = await client.get(f"/api/v1/prompts/versions/{prompt_id}", headers=headers_b)
    assert res.status_code == 404
