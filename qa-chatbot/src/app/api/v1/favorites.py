import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.favorites import (
    FavoriteNotFoundException,
    FavoriteVersionNotFoundException,
)
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.models.favorite_prompt import FavoritePrompt
from app.models.user import User
from app.schemas.favorite import (
    FavoriteCreateRequest,
    FavoriteListResponse,
    FavoriteResponse,
    FavoriteStatusResponse,
    FavoriteTagsResponse,
    FavoriteUpdateRequest,
)
from app.services.favorite_service import FavoriteService

router = APIRouter(prefix="/favorites", tags=["favorites"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


def _to_response(fav: FavoritePrompt) -> FavoriteResponse:
    pv = fav.prompt_version
    return FavoriteResponse(
        id=fav.id,
        prompt_version_id=fav.prompt_version_id,
        prompt_id=str(pv.prompt_id),
        family_name=pv.name,
        version=pv.version,
        content=pv.content,
        note=fav.note,
        tags=list(fav.tags or []),
        category=fav.category,
        is_pinned=fav.is_pinned,
        use_count=fav.use_count,
        last_used_at=fav.last_used_at,
        liked_at=fav.liked_at,
        version_created_at=pv.created_at,
        token_usage=None,
    )


@router.post(
    "", response_model=SuccessResponse[FavoriteResponse], dependencies=[Depends(_default_limiter)]
)
async def like(
    request: FavoriteCreateRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    service = FavoriteService(db)
    try:
        fav, created = await service.like(
            user_id=current_user.id, prompt_version_id=request.prompt_version_id
        )
    except LookupError as exc:
        raise FavoriteVersionNotFoundException() from exc

    fav = await service.repo.get_for_user(favorite_id=fav.id, user_id=current_user.id)  # type: ignore[assignment]
    if fav is None:
        raise FavoriteNotFoundException()
    await db.commit()

    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return SuccessResponse(data=_to_response(fav))


@router.get(
    "/status",
    response_model=SuccessResponse[FavoriteStatusResponse],
    dependencies=[Depends(_default_limiter)],
)
async def status_endpoint(
    prompt_version_id: Annotated[uuid.UUID, Query()],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteStatusResponse]:
    service = FavoriteService(db)
    is_fav, pid = await service.status(user_id=current_user.id, prompt_version_id=prompt_version_id)
    return SuccessResponse(data=FavoriteStatusResponse(is_favorited=is_fav, prompt_store_id=pid))


@router.get(
    "",
    response_model=SuccessResponse[FavoriteListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_favorites(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    tag: list[str] | None = Query(default=None),
    sort: str = Query(default="recently_liked"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> SuccessResponse[FavoriteListResponse]:
    service = FavoriteService(db)
    rows, total = await service.repo.list_for_user(
        user_id=current_user.id,
        q=q,
        category=category,
        tags=tag,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return SuccessResponse(
        data=FavoriteListResponse(
            items=[_to_response(r) for r in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
    )


@router.get(
    "/tags",
    response_model=SuccessResponse[FavoriteTagsResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_tags(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteTagsResponse]:
    service = FavoriteService(db)
    tags = await service.repo.distinct_tags(user_id=current_user.id)
    return SuccessResponse(data=FavoriteTagsResponse(tags=tags))


@router.delete(
    "/by-version/{prompt_version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_default_limiter)],
)
async def unlike_by_version(
    prompt_version_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    deleted = await service.unlike_by_version(
        user_id=current_user.id, prompt_version_id=prompt_version_id
    )
    if not deleted:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{favorite_id}",
    response_model=SuccessResponse[FavoriteResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_favorite(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    service = FavoriteService(db)
    fav = await service.repo.get_for_user(favorite_id=favorite_id, user_id=current_user.id)
    if fav is None:
        raise FavoriteNotFoundException()
    return SuccessResponse(data=_to_response(fav))


@router.patch(
    "/{favorite_id}",
    response_model=SuccessResponse[FavoriteResponse],
    dependencies=[Depends(_default_limiter)],
)
async def update_favorite(
    favorite_id: uuid.UUID,
    request: FavoriteUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    update_fields: dict[str, object] = {}
    if request.note is not None:
        update_fields["note"] = request.note
    if request.tags is not None:
        update_fields["tags"] = request.tags
    if request.category is not None:
        update_fields["category"] = request.category.value
    if request.is_pinned is not None:
        update_fields["is_pinned"] = request.is_pinned

    service = FavoriteService(db)
    fav = await service.update(
        user_id=current_user.id, favorite_id=favorite_id, fields=update_fields
    )
    if fav is None:
        raise FavoriteNotFoundException()

    fav = await service.repo.get_for_user(favorite_id=favorite_id, user_id=current_user.id)
    if fav is None:
        raise FavoriteNotFoundException()
    await db.commit()
    return SuccessResponse(data=_to_response(fav))


@router.post(
    "/{favorite_id}/use",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_default_limiter)],
)
async def use_favorite(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    ok = await service.increment_use(user_id=current_user.id, favorite_id=favorite_id)
    if not ok:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{favorite_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_default_limiter)],
)
async def unlike(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    deleted = await service.unlike(user_id=current_user.id, favorite_id=favorite_id)
    if not deleted:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
