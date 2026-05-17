import hashlib
from collections.abc import AsyncGenerator, Callable
from typing import Annotated, Any

import structlog
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clerk import get_org_permissions_for_api_key, verify_clerk_token
from app.core.exceptions import ForbiddenException, UnauthorizedException
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


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserContext:
    """
    Resolves the current user from a Clerk JWT Bearer token or a qac_-prefixed API key.

    JWT path: verifies via Clerk SDK and looks up user by clerk_user_id.
    API key path: hashes the raw key and looks up via key_hash, then fetches org permissions.
    """
    authorization = request.headers.get("Authorization", "")

    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedException(detail="Missing or invalid Authorization header")

    user_repo = UserRepository(db)
    api_key_repo = ApiKeyRepository(db)

    # API key path — bearer value starts with qac_
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

        api_key_permissions = await get_org_permissions_for_api_key(api_key.org_id)

        structlog.contextvars.bind_contextvars(user_id=str(user.id))
        return UserContext(
            user_id=user.id,
            clerk_user_id=user.clerk_user_id,
            email=user.email,
            credits=user.credits,
            org_id=api_key.org_id,
            org_role="org:admin",
            permissions=api_key_permissions,
        )

    # JWT path — standard Clerk Bearer token
    payload = verify_clerk_token(authorization)
    clerk_user_id: str = payload["sub"]
    org_id: str = payload.get("org_id", "")
    org_role: str = payload.get("org_role", "")
    jwt_permissions: list[str] = payload.get("org_permissions", [])

    user = await user_repo.get_by_clerk_id(clerk_user_id)
    if user is None:
        raise UnauthorizedException(detail="User not found — register via webhook")
    if not user.is_active:
        raise UnauthorizedException(detail="User account is inactive")

    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return UserContext(
        user_id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        credits=user.credits,
        org_id=org_id,
        org_role=org_role,
        permissions=jwt_permissions,
    )


def require_role(*roles: str) -> Callable[..., UserContext]:
    """Return a FastAPI dependency that enforces org role membership."""

    async def _check(
        current_user: Annotated[UserContext, Depends(get_current_user)],
    ) -> UserContext:
        if current_user.org_role not in roles:
            raise ForbiddenException(detail=f"Required role: one of {roles}")
        return current_user

    return _check


def require_permission(permission: str) -> Callable[..., UserContext]:
    """Return a FastAPI dependency that enforces a specific org permission."""

    async def _check(
        current_user: Annotated[UserContext, Depends(get_current_user)],
    ) -> UserContext:
        if permission not in current_user.permissions:
            raise ForbiddenException(detail=f"Missing permission: {permission}")
        return current_user

    return _check
