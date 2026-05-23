"""Unit tests for src/app/dependencies.py — Clerk JWT + API key auth."""

import hashlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import UnauthorizedException
from app.core.user_context import UserContext

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_request(auth_header: str | None) -> MagicMock:
    """Return a minimal mock FastAPI Request with the given Authorization header."""
    request = MagicMock()
    if auth_header is None:
        request.headers = {}
    else:
        request.headers = {"Authorization": auth_header}
    return request


def _make_user(
    *,
    user_id: uuid.UUID | None = None,
    clerk_user_id: str = "user_abc123",
    email: str = "test@example.com",
    credits: int = 100,
    is_active: bool = True,
) -> MagicMock:
    user = MagicMock()
    user.id = user_id or uuid.uuid4()
    user.clerk_user_id = clerk_user_id
    user.email = email
    user.credits = credits
    user.is_active = is_active
    return user


def _make_api_key(
    *,
    key_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    org_id: str = "org_xyz",
) -> MagicMock:
    api_key = MagicMock()
    api_key.id = key_id or uuid.uuid4()
    api_key.created_by = created_by or uuid.uuid4()
    api_key.org_id = org_id
    return api_key


# ---------------------------------------------------------------------------
# Tests: JWT path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_current_user_valid_clerk_jwt_returns_user_context() -> None:
    """Valid Clerk JWT with a known user → returns UserContext with correct org_id."""
    user = _make_user()
    fake_payload = {
        "sub": user.clerk_user_id,
        "org_id": "org_test",
    }

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_clerk_id.return_value = user
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_clerk_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
        patch("structlog.contextvars.bind_contextvars"),
    ):
        from app.dependencies import get_current_user

        result = await get_current_user(request=request, db=mock_db)

    assert isinstance(result, UserContext)
    assert result.clerk_user_id == user.clerk_user_id
    assert result.email == user.email
    assert result.credits == user.credits
    assert result.org_id == "org_test"


@pytest.mark.asyncio
async def test_get_current_user_inactive_user_raises_unauthorized() -> None:
    """Valid Clerk JWT but user.is_active is False → UnauthorizedException."""
    user = _make_user(is_active=False)
    fake_payload = {
        "sub": user.clerk_user_id,
        "org_id": "org_test",
    }

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_clerk_id.return_value = user
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_clerk_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException) as exc_info:
            await get_current_user(request=request, db=mock_db)

    assert "inactive" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Tests: API key path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_current_user_valid_api_key_returns_user_context() -> None:
    """Valid qac_ API key → returns UserContext with org_id from the api_key row."""
    raw_key = "qac_mysupersecretkey"
    user_id = uuid.uuid4()
    user = _make_user(user_id=user_id)
    api_key = _make_api_key(created_by=user_id, org_id="org_apikey")

    request = _make_request(f"Bearer {raw_key}")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_id.return_value = user
    mock_api_key_repo = AsyncMock()
    mock_api_key_repo.get_active_by_hash.return_value = api_key
    mock_api_key_repo.update_last_used = AsyncMock()

    with (
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
        patch("structlog.contextvars.bind_contextvars"),
    ):
        from app.dependencies import get_current_user

        result = await get_current_user(request=request, db=mock_db)

    expected_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    mock_api_key_repo.get_active_by_hash.assert_called_once_with(expected_hash)
    mock_api_key_repo.update_last_used.assert_called_once_with(api_key.id)

    assert isinstance(result, UserContext)
    assert result.org_id == "org_apikey"
    assert result.user_id == user.id


@pytest.mark.asyncio
async def test_get_current_user_invalid_api_key_raises_unauthorized() -> None:
    """qac_ API key that is not found in the DB → UnauthorizedException."""
    raw_key = "qac_nonexistent"

    request = _make_request(f"Bearer {raw_key}")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_api_key_repo = AsyncMock()
    mock_api_key_repo.get_active_by_hash.return_value = None

    with (
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException) as exc_info:
            await get_current_user(request=request, db=mock_db)

    assert "Invalid API key" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Tests: missing / malformed header
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_current_user_missing_header_raises_unauthorized() -> None:
    """No Authorization header → UnauthorizedException."""
    request = _make_request(None)

    mock_db = AsyncMock()

    with (
        patch("app.dependencies.UserRepository"),
        patch("app.dependencies.ApiKeyRepository"),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException) as exc_info:
            await get_current_user(request=request, db=mock_db)

    assert "Missing or invalid" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_non_bearer_header_raises_unauthorized() -> None:
    """Authorization header that does not start with 'Bearer ' → UnauthorizedException."""
    request = _make_request("Basic dXNlcjpwYXNz")

    mock_db = AsyncMock()

    with (
        patch("app.dependencies.UserRepository"),
        patch("app.dependencies.ApiKeyRepository"),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException):
            await get_current_user(request=request, db=mock_db)
