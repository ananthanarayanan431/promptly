from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.categories import (
    CategoryNotFoundException,
    CategorySlugConflictException,
    PredefinedCategoryReadOnlyException,
)
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.models.prompt_category import PromptCategory
from app.models.user import User
from app.schemas.category import (
    CategoryCreateRequest,
    CategoryCreateResponse,
    CategoryListResponse,
    CategoryResponse,
)
from app.services.category_service import CategoryService, SlugConflictError

router = APIRouter(prefix="/categories", tags=["categories"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


def _to_response(cat: PromptCategory) -> CategoryResponse:
    return CategoryResponse(
        slug=cat.slug,
        name=cat.name,
        description=cat.description,
        is_predefined=cat.is_predefined,
        created_at=cat.created_at,
    )


def _sort_categories(cats: list[PromptCategory]) -> list[PromptCategory]:
    """Predefined first (preserving 'general' at the head), then user customs alphabetical."""
    predefined = [c for c in cats if c.is_predefined]
    custom = sorted(
        (c for c in cats if not c.is_predefined),
        key=lambda c: c.name.lower(),
    )

    def _predefined_order(c: PromptCategory) -> tuple[int, str]:
        # Keep "general" pinned to the top of predefined; others alphabetical.
        return (0 if c.slug == "general" else 1, c.name.lower())

    predefined.sort(key=_predefined_order)
    return predefined + custom


@router.get(
    "",
    response_model=SuccessResponse[CategoryListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_categories(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CategoryListResponse]:
    """List predefined categories plus this user's custom categories."""
    service = CategoryService(db)
    cats = await service.list_for_user(user_id=current_user.id)
    sorted_cats = _sort_categories(cats)
    return SuccessResponse(
        data=CategoryListResponse(categories=[_to_response(c) for c in sorted_cats])
    )


@router.post(
    "",
    response_model=SuccessResponse[CategoryCreateResponse],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_default_limiter)],
)
async def create_category(
    request: CategoryCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CategoryCreateResponse]:
    """Create a new custom category for the current user."""
    service = CategoryService(db)
    try:
        cat = await service.create_custom(
            user_id=current_user.id,
            name=request.name,
            description=request.description,
        )
    except SlugConflictError as exc:
        raise CategorySlugConflictException() from exc
    await db.commit()
    return SuccessResponse(data=CategoryCreateResponse(category=_to_response(cat)))


@router.delete(
    "/{slug}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_default_limiter)],
)
async def delete_category(
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Delete a user's custom category. Predefined categories cannot be deleted."""
    service = CategoryService(db)
    # Differentiate "predefined (forbidden)" from "not found".
    visible = await service.repo.get_by_slug_for_user(slug=slug, user_id=current_user.id)
    if visible is not None and visible.is_predefined:
        raise PredefinedCategoryReadOnlyException()

    deleted = await service.delete_custom(user_id=current_user.id, slug=slug)
    if not deleted:
        raise CategoryNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
