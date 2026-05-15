from unittest.mock import AsyncMock, MagicMock

import pytest
from faker import Faker
from httpx import AsyncClient

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


@pytest.mark.asyncio
async def test_register_happy_path(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": fake.unique.email(), "password": "StrongPass1!"},
    )
    assert res.status_code == 200
    assert "id" in res.json()["data"]
    assert "email" in res.json()["data"]


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    email = fake.unique.email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_login_valid_credentials(client: AsyncClient) -> None:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    res = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert res.status_code == 200
    data = res.json()["data"]
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"  # noqa: S105


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    email = fake.unique.email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    res = await client.post("/api/v1/auth/login", data={"username": email, "password": "wrong"})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": "nobody@example.com", "password": "irrelevant"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_get_me_valid_jwt(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    res = await client.get("/api/v1/users/me", headers=auth_headers)
    assert res.status_code == 200
    assert "email" in res.json()["data"]


@pytest.mark.asyncio
async def test_get_me_no_token(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_me_malformed_token(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/me", headers={"Authorization": "Bearer not.a.real.token"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_api_key_create(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "ci-test-key"},
        headers=auth_headers,
    )
    assert res.status_code == 201
    assert res.json()["data"]["key"].startswith("qac_")


@pytest.mark.asyncio
async def test_api_key_auth_on_protected_route(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create_res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "auth-test-key"},
        headers=auth_headers,
    )
    raw_key = create_res.json()["data"]["key"]
    res = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {raw_key}"})
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_api_key_revoked_returns_401(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create_res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "revoke-test-key"},
        headers=auth_headers,
    )
    key_id = create_res.json()["data"]["id"]
    raw_key = create_res.json()["data"]["key"]

    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=auth_headers)

    res = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {raw_key}"})
    assert res.status_code == 401
