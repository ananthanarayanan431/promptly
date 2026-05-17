"""Clerk SDK client utilities and token verification."""

import logging
from collections.abc import Mapping
from functools import lru_cache
from typing import Any

import clerk_backend_api
from clerk_backend_api.security.types import AuthenticateRequestOptions

from app.config.clerk import get_clerk_settings
from app.core.exceptions import UnauthorizedException

logger = logging.getLogger(__name__)


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
        logger.warning("Clerk authenticate_request raised: %s", exc)
        raise UnauthorizedException(detail="Token verification failed") from exc

    if not state.is_signed_in or state.payload is None:
        raise UnauthorizedException(detail="Invalid or expired token")

    return dict(state.payload)


async def get_org_permissions_for_api_key(org_id: str) -> list[str]:
    """Return the permission keys for the owner role of an organization.

    Fetches the org's memberships from Clerk and returns the permission
    strings attached to members with owner-like roles (``org:admin`` /
    ``org:owner``). Falls back to an empty list on any error so the caller
    can degrade gracefully.

    Args:
        org_id: The Clerk organization ID (e.g. ``"org_..."``).

    Returns:
        A list of permission key strings, or an empty list on error.
    """
    client = get_clerk_client()
    try:
        memberships = await client.organization_memberships.list_async(
            organization_id=org_id, limit=500
        )
        owner_role_keys = {"org:admin", "org:owner", "admin", "owner"}
        permissions: list[str] = []
        for member in memberships.data or []:
            role_key: str = getattr(member, "role", "") or ""
            if role_key in owner_role_keys:
                member_permissions = getattr(member, "permissions", None) or []
                permissions.extend(member_permissions)

        return permissions
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not fetch org permissions for %s: %s", org_id, exc)
        return []
