"""Unit tests for src/app/core/supabase_auth.py — Supabase JWT verification.

These exercise the legacy HS256 path end-to-end with a real PyJWT-signed token.
The JWKS (ES256) lookup is forced to miss by raising ``PyJWKClientError`` so the
verifier falls through to the HS256 shared secret without any network call.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest
from jwt.exceptions import PyJWKClientError

from app.core.exceptions import UnauthorizedException

_SECRET = "test-hs256-shared-secret-at-least-32-bytes-long"  # noqa: S105 (test-only secret)
_TARGET = "app.core.supabase_auth"


def _fake_settings() -> MagicMock:
    settings = MagicMock()
    settings.SUPABASE_JWT_SECRET.get_secret_value.return_value = _SECRET
    settings.SUPABASE_URL = "https://example.supabase.co"
    return settings


def _encode(payload: dict, secret: str = _SECRET) -> str:
    return pyjwt.encode(payload, secret, algorithm="HS256")


def test_hs256_valid_token_returns_payload() -> None:
    token = _encode({"sub": "user_abc", "email": "a@b.com", "aud": "authenticated"})

    with (
        patch(f"{_TARGET}.get_supabase_settings", return_value=_fake_settings()),
        patch(f"{_TARGET}._get_jwks_client", side_effect=PyJWKClientError("no jwks")),
    ):
        from app.core.supabase_auth import verify_supabase_token

        payload = verify_supabase_token(token)

    assert payload["sub"] == "user_abc"
    assert payload["email"] == "a@b.com"


def test_hs256_wrong_secret_raises_unauthorized() -> None:
    token = _encode(
        {"sub": "x", "aud": "authenticated"}, secret="a-different-secret-also-32-bytes-long-xx"
    )

    with (
        patch(f"{_TARGET}.get_supabase_settings", return_value=_fake_settings()),
        patch(f"{_TARGET}._get_jwks_client", side_effect=PyJWKClientError("no jwks")),
    ):
        from app.core.supabase_auth import verify_supabase_token

        with pytest.raises(UnauthorizedException):
            verify_supabase_token(token)


def test_wrong_audience_raises_unauthorized() -> None:
    token = _encode({"sub": "x", "aud": "not-authenticated"})

    with (
        patch(f"{_TARGET}.get_supabase_settings", return_value=_fake_settings()),
        patch(f"{_TARGET}._get_jwks_client", side_effect=PyJWKClientError("no jwks")),
    ):
        from app.core.supabase_auth import verify_supabase_token

        with pytest.raises(UnauthorizedException):
            verify_supabase_token(token)


def test_malformed_token_raises_unauthorized() -> None:
    with (
        patch(f"{_TARGET}.get_supabase_settings", return_value=_fake_settings()),
        patch(f"{_TARGET}._get_jwks_client", side_effect=PyJWKClientError("no jwks")),
    ):
        from app.core.supabase_auth import verify_supabase_token

        with pytest.raises(UnauthorizedException):
            verify_supabase_token("not.a.jwt")
