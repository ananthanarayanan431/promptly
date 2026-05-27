"""Integration tests for /api/v1/orgs/api-keys endpoints."""

import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.dependencies import get_current_user, get_db
from app.main import create_app
from app.models.user import User

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ORG_ID = "org_test_orgs"
_OTHER_ORG_ID = "org_other"


def _make_user_context(
    org_id: str = _ORG_ID,
    user_id: uuid.UUID | None = None,
) -> UserContext:
    return UserContext(
        user_id=user_id or uuid.uuid4(),
        clerk_user_id="user_test_clerk",
        email="test@example.com",
        credits=100,
        org_id=org_id,
    )


@pytest_asyncio.fixture(loop_scope="session")
async def _test_user(db_session: AsyncSession) -> User:
    """Create a real User row in the DB (required by the FK on api_keys.created_by)."""
    user = User(
        email="orgs_test_user@example.com",
        clerk_user_id="user_orgs_test_clerk",
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture(loop_scope="session")
async def orgs_client(
    db_session: AsyncSession, _test_user: User
) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient with get_current_user overridden to return an authenticated user context."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    def _override_current_user() -> UserContext:
        return _make_user_context(user_id=_test_user.id)

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(loop_scope="session")
async def other_org_client(
    db_session: AsyncSession, _test_user: User
) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient with get_current_user overridden to return a user from a different org."""
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    def _override_current_user() -> UserContext:
        return _make_user_context(org_id=_OTHER_ORG_ID, user_id=_test_user.id)

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# POST /api/v1/orgs/api-keys — Create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_org_api_key_returns_201_with_key(
    orgs_client: AsyncClient,
) -> None:
    """Authenticated user can create an org API key; response includes the raw qac_ key."""
    res = await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "ci-key"})
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["key"].startswith("qac_")
    assert data["name"] == "ci-key"
    assert data["org_id"] == _ORG_ID
    assert data["is_active"] is True
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_org_api_key_duplicate_name_returns_409(
    orgs_client: AsyncClient,
) -> None:
    """Creating a second key with the same name returns 409 Conflict."""
    await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "dup-key"})
    res = await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "dup-key"})
    assert res.status_code == 409, res.text
    assert "already exists" in res.json()["detail"]


# ---------------------------------------------------------------------------
# GET /api/v1/orgs/api-keys — List
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_org_api_keys_returns_200_list(
    orgs_client: AsyncClient,
) -> None:
    """GET returns a list of keys; no 'key' field exposed."""
    create_res = await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "list-key"})
    assert create_res.status_code == 201

    res = await orgs_client.get("/api/v1/orgs/api-keys")
    assert res.status_code == 200, res.text
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    for item in data:
        assert "key" not in item
        assert "id" in item
        assert "name" in item
        assert "org_id" in item
        assert "is_active" in item


# ---------------------------------------------------------------------------
# DELETE /api/v1/orgs/api-keys/{id} — Revoke
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_org_api_key_returns_204(
    orgs_client: AsyncClient,
) -> None:
    """Revoking an existing key returns 204 No Content."""
    create_res = await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "revoke-me"})
    assert create_res.status_code == 201
    key_id = create_res.json()["id"]

    res = await orgs_client.delete(f"/api/v1/orgs/api-keys/{key_id}")
    assert res.status_code == 204, res.text
    assert res.content == b""


@pytest.mark.asyncio
async def test_revoke_org_api_key_wrong_org_returns_404(
    orgs_client: AsyncClient,
    other_org_client: AsyncClient,
) -> None:
    """Revoking a key that belongs to a different org returns 404."""
    create_res = await orgs_client.post("/api/v1/orgs/api-keys", json={"name": "cross-org-key"})
    assert create_res.status_code == 201
    key_id = create_res.json()["id"]

    res = await other_org_client.delete(f"/api/v1/orgs/api-keys/{key_id}")
    assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_revoke_nonexistent_org_api_key_returns_404(
    orgs_client: AsyncClient,
) -> None:
    """Revoking a key that does not exist returns 404."""
    res = await orgs_client.delete(f"/api/v1/orgs/api-keys/{uuid.uuid4()}")
    assert res.status_code == 404, res.text
