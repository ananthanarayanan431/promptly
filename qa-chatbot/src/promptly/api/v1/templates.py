from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.repositories.template_repo import TemplateRepository
from promptly.schemas.template import TemplateCategoryGroup, TemplateListResponse, TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.get(
    "",
    summary="List prompt templates",
    description="Return the full library of built-in prompt templates grouped by category. Used to pre-populate the editor.",  # noqa: E501
    responses=error_responses(401, 429, 500),
    response_model=SuccessResponse[TemplateListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[TemplateListResponse]:
    """
    Return all active prompt templates grouped by category.
    Templates are global presets — they do not belong to any user.
    """
    repo = TemplateRepository(db)
    templates = await repo.get_active()

    grouped: dict[str, list[TemplateOut]] = {}
    for t in templates:
        out = TemplateOut(
            id=str(t.id),
            category=t.category,
            name=t.name,
            description=t.description,
            content=t.content,
        )
        grouped.setdefault(t.category, []).append(out)

    categories = [
        TemplateCategoryGroup(category=cat, templates=items) for cat, items in grouped.items()
    ]

    return SuccessResponse(data=TemplateListResponse(categories=categories, total=len(templates)))
