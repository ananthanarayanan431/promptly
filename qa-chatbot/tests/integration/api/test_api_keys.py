import uuid

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# LIST — empty and after create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_api_keys_empty(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.get("/api/v1/users/api-keys", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 0
    assert data["keys"] == []


@pytest.mark.asyncio
async def test_list_api_keys_after_create(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    await client.post("/api/v1/users/api-keys", json={"name": "my-key"}, headers=headers)

    res = await client.get("/api/v1/users/api-keys", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert len(data["keys"]) == 1
    assert data["keys"][0]["name"] == "my-key"


@pytest.mark.asyncio
async def test_list_api_keys_status_filter_active(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "active-key"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]
    await client.post("/api/v1/users/api-keys", json={"name": "revoke-me"}, headers=headers)
    revoke_res = await client.get("/api/v1/users/api-keys", headers=headers)
    second_key_id = next(
        k["id"] for k in revoke_res.json()["data"]["keys"] if k["name"] == "revoke-me"
    )
    await client.delete(f"/api/v1/users/api-keys/{second_key_id}", headers=headers)

    res = await client.get("/api/v1/users/api-keys?status=active", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert data["keys"][0]["id"] == key_id
    assert data["keys"][0]["is_active"] is True


@pytest.mark.asyncio
async def test_list_api_keys_status_filter_revoked(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    await client.post("/api/v1/users/api-keys", json={"name": "keep-active"}, headers=headers)
    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "to-revoke"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]
    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers)

    res = await client.get("/api/v1/users/api-keys?status=revoked", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert data["keys"][0]["id"] == key_id
    assert data["keys"][0]["is_active"] is False


# ---------------------------------------------------------------------------
# GET single key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_existing_api_key(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "fetch-me"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == key_id
    assert data["name"] == "fetch-me"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_get_nonexistent_api_key_returns_404(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.get(f"/api/v1/users/api-keys/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_other_users_api_key_returns_404(client: AsyncClient, make_user) -> None:
    """A user cannot retrieve another user's key."""
    _, headers_a = await make_user()
    _, headers_b = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "private-key"}, headers=headers_a
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=headers_b)
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# CREATE — success and duplicate name conflict
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_api_key_returns_201_with_qac_prefix(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.post("/api/v1/users/api-keys", json={"name": "ci-key"}, headers=headers)
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["key"].startswith("qac_")
    assert data["name"] == "ci-key"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_duplicate_name_returns_409(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    await client.post("/api/v1/users/api-keys", json={"name": "dup-key"}, headers=headers)
    res = await client.post("/api/v1/users/api-keys", json={"name": "dup-key"}, headers=headers)
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# REVOKE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_key_returns_200_with_revoked_state(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "revoke-key"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["is_active"] is False
    assert data["revoked_at"] is not None


@pytest.mark.asyncio
async def test_revoke_already_revoked_returns_409(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "double-revoke"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]

    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers)
    res = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_revoke_nonexistent_key_returns_404(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.delete(f"/api/v1/users/api-keys/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_other_user_cannot_get_or_delete_key(client: AsyncClient, make_user) -> None:
    """User A creates a key; User B gets 404 on both GET and DELETE of it."""
    _, headers_a = await make_user()
    _, headers_b = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "owned-by-a"}, headers=headers_a
    )
    key_id = create_res.json()["data"]["id"]

    get_res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=headers_b)
    assert get_res.status_code == 404

    del_res = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers_b)
    assert del_res.status_code == 404

    # The key remains intact and accessible to its owner.
    owner_res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=headers_a)
    assert owner_res.status_code == 200
    assert owner_res.json()["data"]["is_active"] is True


@pytest.mark.asyncio
async def test_list_after_revoke_shows_revoked_in_status_filter(
    client: AsyncClient, make_user
) -> None:
    _, headers = await make_user()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "will-be-revoked"}, headers=headers
    )
    key_id = create_res.json()["data"]["id"]
    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=headers)

    res = await client.get("/api/v1/users/api-keys?status=revoked", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert data["keys"][0]["name"] == "will-be-revoked"
    assert data["keys"][0]["is_active"] is False


# ---------------------------------------------------------------------------
# AUTH guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_api_keys_unauthenticated_returns_401(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/api-keys")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_api_key_unauthenticated_returns_401(client: AsyncClient) -> None:
    res = await client.post("/api/v1/users/api-keys", json={"name": "anon-key"})
    assert res.status_code == 401
