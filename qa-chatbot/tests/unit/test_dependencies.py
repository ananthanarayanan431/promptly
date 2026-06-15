"""Unit tests for src/app/dependencies.py — Supabase JWT + API key auth."""

import hashlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

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
    supabase_user_id: str = "user_abc123",
    email: str = "test@example.com",
    credits: int = 100,
    is_active: bool = True,
) -> MagicMock:
    user = MagicMock()
    user.id = user_id or uuid.uuid4()
    user.supabase_user_id = supabase_user_id
    user.email = email
    user.credits = credits
    user.is_active = is_active
    return user


def _make_api_key(
    *,
    key_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
) -> MagicMock:
    api_key = MagicMock()
    api_key.id = key_id or uuid.uuid4()
    api_key.created_by = created_by or uuid.uuid4()
    return api_key


def _integrity_error() -> IntegrityError:
    """A unique-violation-style IntegrityError matching what create() raises on a race."""
    return IntegrityError("INSERT ...", None, Exception("duplicate key value"))


# ---------------------------------------------------------------------------
# Tests: Supabase JWT path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_current_user_valid_supabase_jwt_returns_user_context() -> None:
    """Valid Supabase JWT with a known user → UserContext."""
    user = _make_user()
    fake_payload = {
        "sub": user.supabase_user_id,
        "email": user.email,
        "user_metadata": {"full_name": "Test User"},
    }

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_supabase_id.return_value = user
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_supabase_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
        patch("structlog.contextvars.bind_contextvars"),
    ):
        from app.dependencies import get_current_user

        result = await get_current_user(request=request, db=mock_db)

    assert isinstance(result, UserContext)
    assert result.supabase_user_id == user.supabase_user_id
    assert result.email == user.email
    assert result.credits == user.credits


@pytest.mark.asyncio
async def test_get_current_user_provisions_user_on_first_login() -> None:
    """Unknown supabase_user_id → _provision_user is called to create the local row."""
    user = _make_user(supabase_user_id="user_new")
    fake_payload = {
        "sub": "user_new",
        "email": "new@example.com",
        "user_metadata": {"full_name": "New User"},
    }

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_supabase_id.return_value = None  # not provisioned yet
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_supabase_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
        patch("app.dependencies._provision_user", AsyncMock(return_value=user)) as mock_provision,
        patch("structlog.contextvars.bind_contextvars"),
    ):
        from app.dependencies import get_current_user

        result = await get_current_user(request=request, db=mock_db)

    mock_provision.assert_awaited_once_with(
        mock_user_repo, "user_new", "new@example.com", "New User"
    )
    assert result.supabase_user_id == user.supabase_user_id


@pytest.mark.asyncio
async def test_get_current_user_missing_email_claim_raises_unauthorized() -> None:
    """A Supabase JWT with no email claim → UnauthorizedException (avoids empty-email rows)."""
    fake_payload = {"sub": "user_no_email", "user_metadata": {}}

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_supabase_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException) as exc_info:
            await get_current_user(request=request, db=mock_db)

    assert "email" in exc_info.value.detail.lower()
    mock_user_repo.get_by_supabase_id.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_current_user_inactive_user_raises_unauthorized() -> None:
    """Valid Supabase JWT but user.is_active is False → UnauthorizedException."""
    user = _make_user(is_active=False)
    fake_payload = {
        "sub": user.supabase_user_id,
        "email": user.email,
        "user_metadata": {},
    }

    request = _make_request("Bearer valid.jwt.token")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_supabase_id.return_value = user
    mock_api_key_repo = AsyncMock()

    with (
        patch("app.dependencies.verify_supabase_token", return_value=fake_payload),
        patch("app.dependencies.UserRepository", return_value=mock_user_repo),
        patch("app.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
    ):
        from app.dependencies import get_current_user

        with pytest.raises(UnauthorizedException) as exc_info:
            await get_current_user(request=request, db=mock_db)

    assert "inactive" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Tests: first-login provisioning race (concurrent inserts)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provision_user_recovers_after_concurrent_insert() -> None:
    """A concurrent request inserts the same Supabase user first; our create() hits a
    unique violation which poisons the session. _provision_user must roll the
    session back and return the row the winner created — not 500 with
    PendingRollbackError.
    """
    user = _make_user(supabase_user_id="user_race")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.db = mock_db
    # create() raises the integrity error (lost the race)
    mock_user_repo.create.side_effect = _integrity_error()
    # after rollback, the winner's committed row is visible by supabase_user_id
    mock_user_repo.get_by_supabase_id.return_value = user

    from app.dependencies import _provision_user

    result = await _provision_user(mock_user_repo, "user_race", "race@example.com", "Race User")

    mock_db.rollback.assert_awaited_once()
    assert result is user


@pytest.mark.asyncio
async def test_provision_user_claims_existing_row_by_email() -> None:
    """A row already exists for this email under a different supabase_user_id — e.g. a
    pre-Supabase account backfilled by the migration. On first login it must be
    claimed (supabase_user_id updated), not duplicated.
    """
    legacy = _make_user(supabase_user_id="__pending__xyz", email="legacy@example.com")

    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.db = mock_db
    mock_user_repo.create.side_effect = _integrity_error()
    mock_user_repo.get_by_supabase_id.return_value = None  # real id not present yet
    mock_user_repo.get_by_email.return_value = legacy
    mock_user_repo.update.return_value = legacy

    from app.dependencies import _provision_user

    result = await _provision_user(mock_user_repo, "user_real", "legacy@example.com", None)

    mock_db.rollback.assert_awaited_once()
    mock_user_repo.update.assert_awaited_once_with(legacy, supabase_user_id="user_real")
    assert result is legacy


@pytest.mark.asyncio
async def test_provision_user_raises_when_no_recovery_possible() -> None:
    """create() fails, no row by supabase_id, no row by email → UnauthorizedException."""
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.db = mock_db
    mock_user_repo.create.side_effect = _integrity_error()
    mock_user_repo.get_by_supabase_id.return_value = None
    mock_user_repo.get_by_email.return_value = None

    from app.dependencies import _provision_user

    with pytest.raises(UnauthorizedException):
        await _provision_user(mock_user_repo, "user_x", "x@example.com", None)

    mock_db.rollback.assert_awaited_once()


# ---------------------------------------------------------------------------
# Tests: API key path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_current_user_valid_api_key_returns_user_context() -> None:
    """Valid qac_ API key → returns UserContext for the key's owner."""
    raw_key = "qac_mysupersecretkey"
    user_id = uuid.uuid4()
    user = _make_user(user_id=user_id)
    api_key = _make_api_key(created_by=user_id)

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
