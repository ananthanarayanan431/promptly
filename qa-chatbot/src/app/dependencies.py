import uuid
from collections.abc import AsyncGenerator
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.env import get_env_settings
from app.core.exceptions import UnauthorizedException
from app.core.security import decode_access_token, hash_api_key
from app.db.session import get_async_session
from app.models.user import User
from app.repositories.user_repo import UserRepository

bearer_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

# Stable stub used when AUTH_ENABLED=False — never persisted to the DB
_ANONYMOUS_USER = User(
    id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
    email="anonymous@local",
    credits=999999,
    is_active=True,
    is_superuser=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    """Returns the compiled LangGraph instance from app state."""
    return request.app.state.graph


async def get_current_user(
    token: Annotated[str | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Resolves the current user from a JWT Bearer token or a qac_-prefixed API key.

    When AUTH_ENABLED=False (default) the check is skipped entirely and a
    fixed anonymous user is returned — useful for local development.
    """
    if not get_env_settings().AUTH_ENABLED:
        return _ANONYMOUS_USER

    if not token:
        raise UnauthorizedException()

    repo = UserRepository(db)

    # API key path — check new api_keys table first, fall back to User.api_key_hash
    if token.startswith("qac_"):
        key_hash = hash_api_key(token)

        # New multi-key table
        from app.repositories.api_key_repo import ApiKeyRepository  # noqa: PLC0415

        api_key_repo = ApiKeyRepository(db)
        api_key = await api_key_repo.get_active_by_hash(key_hash)
        if api_key is not None:
            user = await repo.get_by_id(api_key.user_id)
            if user and user.is_active:
                return user

        # Legacy single-key fallback (User.api_key_hash)
        user = await repo.get_by_api_key_hash(key_hash)
        if not user or not user.is_active:
            raise UnauthorizedException(detail="Invalid API key")
        return user

    # JWT path
    try:
        user_id = decode_access_token(token)
        user = await repo.get_by_id(UUID(user_id))
        if not user or not user.is_active:
            raise UnauthorizedException(detail="User not found or inactive")
        return user
    except (JWTError, ValueError) as e:
        raise UnauthorizedException(detail="Invalid token") from e
