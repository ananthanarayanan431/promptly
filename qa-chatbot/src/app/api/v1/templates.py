from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.template_repo import TemplateRepository
from app.schemas.template import TemplateCategoryGroup, TemplateListResponse, TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=SuccessResponse[TemplateListResponse])
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
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
