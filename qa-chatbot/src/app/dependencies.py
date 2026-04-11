from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedException
from app.core.security import decode_access_token, hash_api_key
from app.db.session import get_async_session
from app.models.user import User
from app.repositories.user_repo import UserRepository

bearer_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    """Returns the compiled LangGraph instance from app state."""
    return request.app.state.graph


async def get_current_user(
    token: str | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Supports both JWT Bearer tokens and raw API keys.
    JWT:     Authorization: Bearer <jwt>
    API Key: Authorization: Bearer qac_<key>
    """
    if not token:
        raise UnauthorizedException()

    repo = UserRepository(db)

    # API key path
    if token.startswith("qac_"):
        key_hash = hash_api_key(token)
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
