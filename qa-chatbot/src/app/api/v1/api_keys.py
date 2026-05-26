import math
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from fastapi import status as http_status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.api_keys import (
    ApiKeyAlreadyRevokedException,
    ApiKeyNameConflictException,
    ApiKeyNotFoundException,
)
from app.core.api_key_utils import generate_api_key
from app.core.rate_limit import RateLimiter
from app.core.user_context import UserContext
from app.dependencies import get_current_user, get_db
from app.repositories.api_key_repo import ApiKeyRepository
from app.schemas.api_key import (
    ApiKeyCreatedResponse,
    ApiKeyCreateRequest,
    ApiKeyResponse,
    PaginatedApiKeyListResponse,
)
from app.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(
    prefix="/users/api-keys",
    tags=["api-keys"],
)
_default_limiter = RateLimiter(requests=60, window_seconds=60)


# -------------------------
# CREATE API KEY
# -------------------------
@router.post(
    "",
    response_model=SuccessResponse[ApiKeyCreatedResponse],
    status_code=http_status.HTTP_201_CREATED,
    dependencies=[Depends(_default_limiter)],
)
async def create_api_key(
    request: ApiKeyCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyCreatedResponse]:
    """Create a new API key. The raw key is returned once and never stored."""

    org_id = current_user.clerk_user_id
    repo = ApiKeyRepository(db)
    if await repo.has_active_org_name(org_id, request.name):
        log.warning("api_key_name_conflict", name=request.name)
        raise ApiKeyNameConflictException()

    raw_key, key_hash = generate_api_key()
    try:
        key = await repo.create(
            org_id=org_id,
            created_by=current_user.user_id,
            name=request.name,
            key_hash=key_hash,
        )
        await db.flush()
    except IntegrityError as e:
        orig = getattr(e, "orig", None)
        pgcode = getattr(orig, "pgcode", None) or getattr(orig, "sqlstate", None)
        if pgcode == "23505":
            log.warning("api_key_name_conflict", name=request.name)
            raise ApiKeyNameConflictException() from None
        raise
    log.info("api_key_created", key_id=str(key.id), name=key.name)
    return SuccessResponse(
        data=ApiKeyCreatedResponse(
            id=key.id,
            name=key.name,
            key=raw_key,
            created_at=key.created_at,
        )
    )


# -------------------------
# LIST API KEYS (Paginated)
# -------------------------
@router.get(
    "",
    response_model=SuccessResponse[PaginatedApiKeyListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status: Annotated[
        Literal["active", "revoked", "all"], Query(description="Filter by key status")
    ] = "all",
) -> SuccessResponse[PaginatedApiKeyListResponse]:
    """List API keys for the current user's org with pagination and optional status filter."""
    org_id = current_user.clerk_user_id
    repo = ApiKeyRepository(db)
    offset = (page - 1) * page_size
    total = await repo.count_by_org(org_id, status=status)
    keys = await repo.list_by_org(org_id, status=status, limit=page_size, offset=offset)
    total_pages = math.ceil(total / page_size) if total else 0
    return SuccessResponse(
        data=PaginatedApiKeyListResponse(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
            keys=[ApiKeyResponse.model_validate(k) for k in keys],
        )
    )


# -------------------------
# GET API KEY
# -------------------------
@router.get(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Get metadata for a single API key."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_org(key_id, current_user.clerk_user_id)
    if not key:
        raise ApiKeyNotFoundException()
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))


# -------------------------
# REVOKE API KEY
# -------------------------
@router.delete(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Revoke an API key (soft delete)."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_org(key_id, current_user.clerk_user_id)
    if not key:
        raise ApiKeyNotFoundException()
    if not key.is_active:
        raise ApiKeyAlreadyRevokedException()
    key = await repo.revoke(key)
    await db.flush()
    log.info("api_key_revoked", key_id=str(key_id))
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))
