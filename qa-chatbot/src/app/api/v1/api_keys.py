import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.api_keys import (
    ApiKeyAlreadyRevokedException,
    ApiKeyNameConflictException,
    ApiKeyNotFoundException,
)
from app.core.rate_limit import RateLimiter
from app.core.security import generate_api_key
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.api_key_repo import ApiKeyRepository
from app.schemas.api_key import (
    ApiKeyCreatedResponse,
    ApiKeyCreateRequest,
    ApiKeyListResponse,
    ApiKeyResponse,
)

router = APIRouter(prefix="/users/api-keys", tags=["api-keys"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.post(
    "",
    response_model=SuccessResponse[ApiKeyCreatedResponse],
    status_code=201,
    dependencies=[Depends(_default_limiter)],
)
async def create_api_key(
    request: ApiKeyCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyCreatedResponse]:
    """Create a new API key. The raw key is returned once and never stored."""
    repo = ApiKeyRepository(db)
    if await repo.has_active_name(current_user.id, request.name):
        raise ApiKeyNameConflictException()

    raw_key, key_hash = generate_api_key()
    key = await repo.create(
        user_id=current_user.id,
        name=request.name,
        key_hash=key_hash,
    )
    await db.commit()
    return SuccessResponse(
        data=ApiKeyCreatedResponse(
            id=key.id,
            name=key.name,
            key=raw_key,
            created_at=key.created_at,
        )
    )


@router.get(
    "",
    response_model=SuccessResponse[ApiKeyListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyListResponse]:
    """List all API keys for the current user (active and revoked)."""
    repo = ApiKeyRepository(db)
    keys = await repo.list_by_user(current_user.id)
    return SuccessResponse(
        data=ApiKeyListResponse(keys=[ApiKeyResponse.model_validate(k) for k in keys])
    )


@router.get(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Get metadata for a single API key."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_user(key_id, current_user.id)
    if not key:
        raise ApiKeyNotFoundException()
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))


@router.delete(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Revoke an API key (soft delete)."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_user(key_id, current_user.id)
    if not key:
        raise ApiKeyNotFoundException()
    if not key.is_active:
        raise ApiKeyAlreadyRevokedException()
    key = await repo.revoke(key)
    await db.commit()
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))
