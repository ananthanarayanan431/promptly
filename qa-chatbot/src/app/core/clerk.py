"""Clerk SDK client utilities and token verification."""

from collections.abc import Mapping
from functools import lru_cache
from typing import Any

import clerk_backend_api
from clerk_backend_api.security.types import AuthenticateRequestOptions

from app.config.clerk import get_clerk_settings
from app.core.exceptions import UnauthorizedException
from app.utils.log import get_logger

log = get_logger(__name__)


class _MinimalRequest:
    """Minimal Requestish-compatible wrapper for passing an Authorization header."""

    def __init__(self, auth_header: str) -> None:
        self._auth_header = auth_header

    @property
    def headers(self) -> Mapping[str, str]:
        return {"authorization": self._auth_header}


@lru_cache
def get_clerk_client() -> clerk_backend_api.Clerk:
    """Return a cached Clerk SDK instance initialized with the secret key."""
    settings = get_clerk_settings()
    return clerk_backend_api.Clerk(bearer_auth=settings.CLERK_SECRET_KEY.get_secret_value())


def verify_clerk_token(authorization_header: str) -> dict[str, Any]:
    """Verify a Clerk JWT and return the payload.

    Raises UnauthorizedException if the token is missing, malformed, or invalid.
    """
    client = get_clerk_client()
    settings = get_clerk_settings()

    options = AuthenticateRequestOptions(
        secret_key=settings.CLERK_SECRET_KEY.get_secret_value(),
        authorized_parties=[settings.CLERK_AUTHORIZED_PARTY],
    )

    try:
        state = client.authenticate_request(_MinimalRequest(authorization_header), options)
    except Exception as exc:
        log.warning("clerk_token_verification_failed", error=str(exc))
        raise UnauthorizedException(detail="Token verification failed") from exc

    if not state.is_signed_in or state.payload is None:
        raise UnauthorizedException(detail="Invalid or expired token")

    return dict(state.payload)
