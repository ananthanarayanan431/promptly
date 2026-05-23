import hashlib
from collections.abc import AsyncGenerator
from typing import Annotated, Any

import structlog
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clerk import get_clerk_client, verify_clerk_token
from app.core.exceptions import UnauthorizedException
from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.repositories.api_key_repo import ApiKeyRepository
from app.repositories.user_repo import UserRepository


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    """Returns the compiled LangGraph instance from app state."""
    return request.app.state.graph


async def _provision_user(user_repo: UserRepository, clerk_user_id: str) -> Any:  # noqa: ANN401
    """Fetch the Clerk user profile and create the local DB record on first login.

    This is the fallback when the webhook hasn't fired yet (e.g., local dev
    without a public webhook URL). Idempotent — if a concurrent request already
    created the row, get_by_clerk_id returns it on the next call.
    """
    log = structlog.get_logger()
    try:
        client = get_clerk_client()
        clerk_user = await client.users.get_async(user_id=clerk_user_id)
        email_addresses = getattr(clerk_user, "email_addresses", []) or []
        email: str = email_addresses[0].email_address if email_addresses else ""
        first_name: str = str(getattr(clerk_user, "first_name", "") or "")
        last_name: str = str(getattr(clerk_user, "last_name", "") or "")
        full_name: str = f"{first_name} {last_name}".strip()
    except Exception as exc:  # noqa: BLE001
        log.warning("clerk_user_fetch_failed", clerk_user_id=clerk_user_id, error=str(exc))
        raise UnauthorizedException(detail="User not found and could not be provisioned") from exc

    try:
        user = await user_repo.create(
            clerk_user_id=clerk_user_id,
            email=email,
            full_name=full_name or None,
        )
        log.info("user_auto_provisioned", clerk_user_id=clerk_user_id, email=email)
        return user
    except Exception:  # noqa: BLE001
        # Race condition: another request created the row; just re-fetch.
        existing = await user_repo.get_by_clerk_id(clerk_user_id)
        if existing is None:
            raise UnauthorizedException(detail="User provisioning failed") from None
        return existing


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserContext:
    """
    Resolves the current user from a Clerk JWT Bearer token or a qac_-prefixed API key.
    """
    authorization = request.headers.get("Authorization", "")
    log = structlog.get_logger()

    if not authorization or not authorization.startswith("Bearer "):
        log.warning("auth_header_missing", path=request.url.path, has_auth=bool(authorization))
        raise UnauthorizedException(detail="Missing or invalid Authorization header")

    user_repo = UserRepository(db)
    api_key_repo = ApiKeyRepository(db)

    if authorization.startswith("Bearer qac_"):
        raw_key = authorization.removeprefix("Bearer ")
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        api_key = await api_key_repo.get_active_by_hash(key_hash)
        if api_key is None:
            raise UnauthorizedException(detail="Invalid API key")

        await api_key_repo.update_last_used(api_key.id)

        user = await user_repo.get_by_id(api_key.created_by)
        if user is None or not user.is_active:
            raise UnauthorizedException(detail="Invalid API key")

        structlog.contextvars.bind_contextvars(user_id=str(user.id))
        return UserContext(
            user_id=user.id,
            clerk_user_id=user.clerk_user_id,
            email=user.email,
            credits=user.credits,
            org_id=api_key.org_id,
        )

    payload = verify_clerk_token(authorization)
    clerk_user_id: str = payload["sub"]
    org_id: str = payload.get("org_id", "")

    user = await user_repo.get_by_clerk_id(clerk_user_id)
    if user is None:
        user = await _provision_user(user_repo, clerk_user_id)
    if not user.is_active:
        raise UnauthorizedException(detail="User account is inactive")

    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return UserContext(
        user_id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        credits=user.credits,
        org_id=org_id,
    )
