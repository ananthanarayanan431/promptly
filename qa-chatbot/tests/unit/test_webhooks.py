"""Unit tests for the Clerk webhook handler (src/app/api/v1/webhooks.py)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SVIX_ID = "msg_test123"
_SVIX_TIMESTAMP = "1700000000"
_SVIX_SIGNATURE = "v1,test_sig"

_VALID_SVIX_HEADERS = {
    "svix-id": _SVIX_ID,
    "svix-timestamp": _SVIX_TIMESTAMP,
    "svix-signature": _SVIX_SIGNATURE,
}


def _make_user_created_payload(
    clerk_user_id: str = "user_clerk123",
    email: str = "alice@example.com",
    first_name: str = "Alice",
    last_name: str = "Smith",
) -> dict:
    return {
        "type": "user.created",
        "data": {
            "id": clerk_user_id,
            "email_addresses": [{"email_address": email}],
            "first_name": first_name,
            "last_name": last_name,
        },
    }


def _make_user_deleted_payload(clerk_user_id: str = "user_clerk123") -> dict:
    return {
        "type": "user.deleted",
        "data": {"id": clerk_user_id},
    }


def _make_request(payload: dict) -> MagicMock:
    """Return a mock FastAPI Request whose .body() yields the JSON-encoded payload."""
    request = MagicMock()
    body_bytes = json.dumps(payload).encode()
    request.body = AsyncMock(return_value=body_bytes)
    return request


def _make_mock_user(*, clerk_user_id: str = "user_clerk123", is_active: bool = True) -> MagicMock:
    user = MagicMock()
    user.clerk_user_id = clerk_user_id
    user.is_active = is_active
    return user


# ---------------------------------------------------------------------------
# Tests: user.created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_created_valid_signature_creates_user() -> None:
    """user.created with valid signature → creates user, returns {"status": "ok"}."""
    payload = _make_user_created_payload()
    request = _make_request(payload)
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.create = AsyncMock(return_value=_make_mock_user())

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch(
            "app.api.v1.webhooks._verify_webhook",
            return_value=payload,
        ),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}
    mock_user_repo.create.assert_awaited_once_with(
        clerk_user_id="user_clerk123",
        email="alice@example.com",
        full_name="Alice Smith",
    )


@pytest.mark.asyncio
async def test_user_created_existing_user_returns_200_idempotent() -> None:
    """user.created for an existing user (IntegrityError) → 200, no error raised."""
    from sqlalchemy.exc import IntegrityError

    payload = _make_user_created_payload()
    request = _make_request(payload)
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.create = AsyncMock(side_effect=IntegrityError("dup", {}, Exception()))

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch("app.api.v1.webhooks._verify_webhook", return_value=payload),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}


@pytest.mark.asyncio
async def test_user_created_full_name_strips_whitespace() -> None:
    """user.created with empty first/last names → full_name is None (stripped to empty)."""
    payload = _make_user_created_payload(first_name="", last_name="")
    request = _make_request(payload)
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.create = AsyncMock(return_value=_make_mock_user())

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch("app.api.v1.webhooks._verify_webhook", return_value=payload),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}
    mock_user_repo.create.assert_awaited_once_with(
        clerk_user_id="user_clerk123",
        email="alice@example.com",
        full_name=None,  # empty string → stored as None
    )


# ---------------------------------------------------------------------------
# Tests: user.deleted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_deleted_valid_signature_deactivates_user() -> None:
    """user.deleted with valid signature → sets is_active=False, returns {"status": "ok"}."""
    payload = _make_user_deleted_payload()
    request = _make_request(payload)
    mock_db = AsyncMock()

    existing_user = _make_mock_user()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_clerk_id = AsyncMock(return_value=existing_user)

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch("app.api.v1.webhooks._verify_webhook", return_value=payload),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}
    assert existing_user.is_active is False
    mock_db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_user_deleted_unknown_user_returns_200_idempotent() -> None:
    """user.deleted for a user not in the DB → 200, no error raised."""
    payload = _make_user_deleted_payload(clerk_user_id="user_ghost")
    request = _make_request(payload)
    mock_db = AsyncMock()

    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_clerk_id = AsyncMock(return_value=None)

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch("app.api.v1.webhooks._verify_webhook", return_value=payload),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}
    mock_db.flush.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests: unknown events
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_event_returns_200() -> None:
    """Unknown event type → logged and acknowledged with 200."""
    payload = {"type": "session.created", "data": {}}
    request = _make_request(payload)
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch("app.api.v1.webhooks._verify_webhook", return_value=payload),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
        patch("app.api.v1.webhooks.UserRepository", return_value=mock_user_repo),
    ):
        from app.api.v1.webhooks import clerk_webhook

        result = await clerk_webhook(
            request=request,
            db=mock_db,
            svix_id=_SVIX_ID,
            svix_timestamp=_SVIX_TIMESTAMP,
            svix_signature=_SVIX_SIGNATURE,
        )

    assert result == {"status": "ok"}
    mock_user_repo.create.assert_not_awaited()
    mock_user_repo.get_by_clerk_id.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests: invalid signature
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_signature_returns_400() -> None:
    """Invalid SVIX signature → HTTPException 400."""
    payload = _make_user_created_payload()
    request = _make_request(payload)
    mock_db = AsyncMock()

    mock_clerk_settings = MagicMock()
    mock_clerk_settings.CLERK_WEBHOOK_SECRET.get_secret_value.return_value = "whsec_test"

    with (
        patch(
            "app.api.v1.webhooks._verify_webhook",
            side_effect=HTTPException(status_code=400, detail="Invalid webhook signature"),
        ),
        patch("app.api.v1.webhooks.get_clerk_settings", return_value=mock_clerk_settings),
    ):
        from app.api.v1.webhooks import clerk_webhook

        with pytest.raises(HTTPException) as exc_info:
            await clerk_webhook(
                request=request,
                db=mock_db,
                svix_id=_SVIX_ID,
                svix_timestamp=_SVIX_TIMESTAMP,
                svix_signature=_SVIX_SIGNATURE,
            )

    assert exc_info.value.status_code == 400
    assert "Invalid webhook signature" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Tests: _verify_webhook helper
# ---------------------------------------------------------------------------


def test_verify_webhook_raises_400_on_invalid_signature() -> None:
    """_verify_webhook raises HTTPException(400) when SVIX rejects the signature."""
    from svix.webhooks import WebhookVerificationError

    # Patch at the module level where Webhook is now imported
    with patch("app.api.v1.webhooks.Webhook") as mock_webhook_cls:
        instance = mock_webhook_cls.return_value
        instance.verify.side_effect = WebhookVerificationError()

        from app.api.v1.webhooks import _verify_webhook

        with pytest.raises(HTTPException) as exc_info:
            _verify_webhook(b'{"type":"user.created"}', _VALID_SVIX_HEADERS, "whsec_test")

    assert exc_info.value.status_code == 400
    assert "Invalid webhook signature" in exc_info.value.detail


def test_verify_webhook_returns_parsed_payload_on_success() -> None:
    """_verify_webhook returns the parsed payload dict when the signature is valid."""
    expected = {"type": "user.created", "data": {"id": "user_1"}}

    with patch("app.api.v1.webhooks.Webhook") as mock_webhook_cls:
        instance = mock_webhook_cls.return_value
        instance.verify.return_value = expected

        from app.api.v1.webhooks import _verify_webhook

        result = _verify_webhook(b'{"type":"user.created"}', _VALID_SVIX_HEADERS, "whsec_test")

    assert result == expected
