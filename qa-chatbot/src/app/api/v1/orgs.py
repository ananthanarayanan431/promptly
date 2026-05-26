import hashlib
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.core.user_context import UserContext
from app.dependencies import get_current_user, get_db
from app.repositories.api_key_repo import ApiKeyRepository
from app.schemas.org import ApiKeyCreate, ApiKeyCreatedResponse, ApiKeyResponse

router = APIRouter(tags=["orgs"])


@router.post(
    "/orgs/api-keys",
    response_model=ApiKeyCreatedResponse,
    status_code=http_status.HTTP_201_CREATED,
)
async def create_org_api_key(
    body: ApiKeyCreate,
    current_user: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiKeyCreatedResponse:
    """Create a new org-level API key. The raw key is returned once and never stored."""
    api_key_repo = ApiKeyRepository(db)

    if await api_key_repo.has_active_org_name(current_user.org_id, body.name):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="An active API key with this name already exists",
        )

    raw_key = f"qac_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    try:
        key = await api_key_repo.create(
            org_id=current_user.org_id,
            name=body.name,
            key_hash=key_hash,
            created_by=current_user.user_id,
        )
    except IntegrityError:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="An active API key with this name already exists",
        ) from None

    return ApiKeyCreatedResponse(
        id=key.id,
        name=key.name,
        org_id=key.org_id,
        is_active=key.is_active,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        key=raw_key,
    )


@router.get(
    "/orgs/api-keys",
    response_model=list[ApiKeyResponse],
)
async def list_org_api_keys(
    current_user: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ApiKeyResponse]:
    """List all API keys for the current user's organisation."""
    api_key_repo = ApiKeyRepository(db)
    keys = await api_key_repo.list_by_org(current_user.org_id)
    return [ApiKeyResponse.model_validate(k) for k in keys]


@router.delete(
    "/orgs/api-keys/{key_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
)
async def revoke_org_api_key(
    key_id: UUID,
    current_user: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Revoke an org API key (soft delete)."""
    api_key_repo = ApiKeyRepository(db)
    api_key = await api_key_repo.get_by_id_and_org(key_id, current_user.org_id)
    if api_key is None:
        raise NotFoundException(detail="API key not found")
    await api_key_repo.deactivate(key_id)
