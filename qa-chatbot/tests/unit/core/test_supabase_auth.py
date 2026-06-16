import time
from unittest.mock import MagicMock

import jwt
import pytest
from jwt import PyJWKClientError

from promptly.core.exceptions import UnauthorizedException
from promptly.core.supabase_auth import verify_supabase_token

_SECRET = "test-secret-that-is-long-enough-for-hs256!!"  # noqa: S105


def _make_hs256_token(overrides: dict | None = None) -> str:
    payload = {
        "sub": "abc-123",
        "email": "test@example.com",
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        "user_metadata": {"full_name": "Test User"},
    }
    if overrides:
        payload.update(overrides)
    return jwt.encode(payload, _SECRET, algorithm="HS256")


@pytest.fixture(autouse=True)
def _mock_settings_and_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeSecret:
        def get_secret_value(self) -> str:
            return _SECRET

    class _FakeSettings:
        SUPABASE_URL = "https://fake.supabase.co"
        SUPABASE_JWT_SECRET = _FakeSecret()

    monkeypatch.setattr(
        "promptly.core.supabase_auth.get_supabase_settings", lambda: _FakeSettings()
    )

    # Make JWKS lookup always fail so tests fall through to HS256 path
    mock_jwks = MagicMock()
    mock_jwks.get_signing_key_from_jwt.side_effect = PyJWKClientError("no JWKS in tests")
    monkeypatch.setattr("promptly.core.supabase_auth._get_jwks_client", lambda: mock_jwks)


def test_valid_token_returns_payload() -> None:
    token = _make_hs256_token()
    payload = verify_supabase_token(token)
    assert payload["sub"] == "abc-123"
    assert payload["email"] == "test@example.com"


def test_expired_token_raises() -> None:
    token = _make_hs256_token({"exp": int(time.time()) - 10})
    with pytest.raises(UnauthorizedException):
        verify_supabase_token(token)


def test_wrong_secret_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    class _WrongSecret:
        def get_secret_value(self) -> str:
            return "wrong-secret!!"

    class _WrongSettings:
        SUPABASE_URL = "https://fake.supabase.co"
        SUPABASE_JWT_SECRET = _WrongSecret()

    monkeypatch.setattr(
        "promptly.core.supabase_auth.get_supabase_settings", lambda: _WrongSettings()
    )
    token = _make_hs256_token()
    with pytest.raises(UnauthorizedException):
        verify_supabase_token(token)
