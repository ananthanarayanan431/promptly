import uuid

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.user import User

fake = Faker()


async def _make_user(db: AsyncSession, email: str | None = None) -> tuple[User, str]:
    """Create a bare User row and return (user, jwt_token)."""
    user = User(email=email or fake.unique.email())
    db.add(user)
    await db.flush()
    token = create_access_token(subject=str(user.id))
    return user, token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# LIST — empty and after create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_api_keys_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    res = await client.get("/api/v1/users/api-keys", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 0
    assert data["keys"] == []


@pytest.mark.asyncio
async def test_list_api_keys_after_create(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    await client.post("/api/v1/users/api-keys", json={"name": "my-key"}, headers=_auth(token))

    res = await client.get("/api/v1/users/api-keys", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert len(data["keys"]) == 1
    assert data["keys"][0]["name"] == "my-key"


@pytest.mark.asyncio
async def test_list_api_keys_status_filter_active(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "active-key"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]
    await client.post("/api/v1/users/api-keys", json={"name": "revoke-me"}, headers=_auth(token))
    revoke_res = await client.get("/api/v1/users/api-keys", headers=_auth(token))
    second_key_id = next(
        k["id"] for k in revoke_res.json()["data"]["keys"] if k["name"] == "revoke-me"
    )
    await client.delete(f"/api/v1/users/api-keys/{second_key_id}", headers=_auth(token))

    res = await client.get("/api/v1/users/api-keys?status=active", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert data["keys"][0]["id"] == key_id
    assert data["keys"][0]["is_active"] is True


@pytest.mark.asyncio
async def test_list_api_keys_status_filter_revoked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    await client.post("/api/v1/users/api-keys", json={"name": "keep-active"}, headers=_auth(token))
    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "to-revoke"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]
    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))

    res = await client.get("/api/v1/users/api-keys?status=revoked", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 1
    assert data["keys"][0]["id"] == key_id
    assert data["keys"][0]["is_active"] is False


# ---------------------------------------------------------------------------
# GET single key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_existing_api_key(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "fetch-me"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == key_id
    assert data["name"] == "fetch-me"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_get_nonexistent_api_key_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    res = await client.get(f"/api/v1/users/api-keys/{uuid.uuid4()}", headers=_auth(token))
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_other_users_api_key_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A user cannot retrieve another user's key."""
    _, token_a = await _make_user(db_session)
    _, token_b = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "private-key"}, headers=_auth(token_a)
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.get(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token_b))
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# CREATE — success and duplicate name conflict
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_api_key_returns_201_with_qac_prefix(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    res = await client.post("/api/v1/users/api-keys", json={"name": "ci-key"}, headers=_auth(token))
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["key"].startswith("qac_")
    assert data["name"] == "ci-key"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_duplicate_name_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    await client.post("/api/v1/users/api-keys", json={"name": "dup-key"}, headers=_auth(token))
    res = await client.post(
        "/api/v1/users/api-keys", json={"name": "dup-key"}, headers=_auth(token)
    )
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# REVOKE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_key_returns_200_with_revoked_state(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "revoke-key"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]

    res = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["is_active"] is False
    assert data["revoked_at"] is not None


@pytest.mark.asyncio
async def test_revoke_already_revoked_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "double-revoke"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]

    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))
    res = await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_revoke_nonexistent_key_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    res = await client.delete(f"/api/v1/users/api-keys/{uuid.uuid4()}", headers=_auth(token))
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_list_after_revoke_shows_revoked_in_status_filter(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/users/api-keys", json={"name": "will-be-revoked"}, headers=_auth(token)
    )
    key_id = create_res.json()["data"]["id"]
    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=_auth(token))

    res = await client.get("/api/v1/users/api-keys?status=revoked", headers=_auth(token))
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
