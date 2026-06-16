import ssl
from functools import lru_cache
from typing import Any

import certifi
import jwt
from jwt import PyJWKClient
from jwt.exceptions import (
    InvalidTokenError,
    PyJWKClientConnectionError,
    PyJWKClientError,
)

from promptly.config.supabase import get_supabase_settings
from promptly.core.exceptions import UnauthorizedException
from promptly.utils.log import get_logger

log = get_logger(__name__)


@lru_cache(maxsize=1)
def _get_jwks_client() -> PyJWKClient:
    """Cached JWKS client — fetches Supabase public keys once and caches them.

    Pass an explicit SSL context backed by certifi's CA bundle. Python.framework
    builds (notably macOS) ship without a usable system trust store, so the
    stdlib urllib fetch PyJWKClient performs would otherwise fail with
    CERTIFICATE_VERIFY_FAILED — silently dropping ES256 verification and
    rejecting every real Supabase token.
    """
    settings = get_supabase_settings()
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    return PyJWKClient(
        f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        ssl_context=ssl_context,
    )


def verify_supabase_token(token: str) -> dict[str, Any]:
    """Verify a Supabase JWT and return the decoded payload.

    Supports both the new ECC (P-256 / ES256) signing keys and the legacy
    HS256 shared secret, so tokens issued before and after the JWKS migration
    both work.

    Raises UnauthorizedException if the token is invalid, expired, or untrusted.
    """
    settings = get_supabase_settings()

    # Try JWKS first (current ECC / ES256 signing key)
    signing_key = None
    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as exc:
        # Infrastructure failure (e.g. CERTIFICATE_VERIFY_FAILED, network) — NOT a
        # bad token. Without this log the failure is invisible and every ES256
        # token silently falls through to HS256 and gets rejected as "invalid".
        log.error("supabase_jwks_fetch_failed", error=str(exc))
    except PyJWKClientError:
        pass  # key not found — legacy token without JWKS entry, fall through to HS256

    if signing_key is not None:
        # We resolved the signing key — any decode failure is a definitive bad token,
        # not a "try another algorithm" situation.
        try:
            payload: dict[str, Any] = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
            )
            return payload
        except InvalidTokenError as exc:
            log.warning("supabase_es256_token_invalid", error=str(exc))
            raise UnauthorizedException(detail="Invalid or expired token") from exc

    # Fallback: legacy HS256 shared secret (for tokens issued before JWKS migration)
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET.get_secret_value(),
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except InvalidTokenError as exc:
        log.warning("supabase_token_verification_failed", error=str(exc))
        raise UnauthorizedException(detail="Invalid or expired token") from exc
