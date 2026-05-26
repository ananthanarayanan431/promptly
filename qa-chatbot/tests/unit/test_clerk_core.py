from unittest.mock import MagicMock, patch

import pytest

from app.core.exceptions import UnauthorizedException


def test_minimal_request_auth_header_readable_by_clerk_sdk() -> None:
    """The Clerk SDK extracts the bearer token via request.headers.get('Authorization')
    (capitalized, case-sensitive on a plain dict). _MinimalRequest must expose the
    header case-insensitively or the SDK reports SESSION_TOKEN_MISSING and every
    authenticated request 401s.
    """
    from clerk_backend_api.security.authenticaterequest import _get_session_token

    from app.core.clerk import _MinimalRequest

    req = _MinimalRequest("Bearer header.payload.signature")
    assert _get_session_token(req) == "header.payload.signature"


def test_verify_clerk_token_returns_payload_on_success() -> None:
    fake_payload = {
        "sub": "user_abc",
        "org_id": "org_xyz",
    }
    with (
        patch("app.core.clerk.get_clerk_client") as mock_get_client,
        patch("app.core.clerk.get_clerk_settings") as mock_get_settings,
    ):
        mock_settings = MagicMock()
        mock_settings.CLERK_SECRET_KEY.get_secret_value.return_value = "sk_test_fake"
        mock_settings.CLERK_AUTHORIZED_PARTY = "http://localhost:3000"
        mock_get_settings.return_value = mock_settings

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.authenticate_request.return_value = MagicMock(
            is_signed_in=True, payload=fake_payload
        )

        from app.core.clerk import verify_clerk_token

        result = verify_clerk_token("Bearer valid.jwt.token")

    assert result["sub"] == "user_abc"
    assert result["org_id"] == "org_xyz"


def test_verify_clerk_token_raises_on_invalid() -> None:
    with (
        patch("app.core.clerk.get_clerk_client") as mock_get_client,
        patch("app.core.clerk.get_clerk_settings") as mock_get_settings,
    ):
        mock_settings = MagicMock()
        mock_settings.CLERK_SECRET_KEY.get_secret_value.return_value = "sk_test_fake"
        mock_settings.CLERK_AUTHORIZED_PARTY = "http://localhost:3000"
        mock_get_settings.return_value = mock_settings

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.authenticate_request.return_value = MagicMock(is_signed_in=False, payload=None)

        from app.core.clerk import verify_clerk_token

        with pytest.raises(UnauthorizedException):
            verify_clerk_token("Bearer invalid.token")
