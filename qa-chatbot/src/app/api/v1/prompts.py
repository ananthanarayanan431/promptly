import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.prompt import (
    PromptAdvisoryRequest,
    PromptAdvisoryResponse,
    PromptFamilyListResponse,
    PromptHealthScoreRequest,
    PromptHealthScoreResponse,
    PromptVersionCreateRequest,
    PromptVersionCreateResponse,
    PromptVersionListResponse,
)
from app.services.prompt_service import PromptService, PromptVersioningService

router = APIRouter(prefix="/prompts", tags=["prompts"])


# ---------------------------------------------------------------------------
# Analysis endpoints
# ---------------------------------------------------------------------------


@router.post("/health-score", response_model=SuccessResponse[PromptHealthScoreResponse])
async def prompt_health_score(
    request: PromptHealthScoreRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptHealthScoreResponse]:
    """
    Score a prompt across eight quality dimensions: clarity, specificity, completeness,
    conciseness, tone, actionability, context richness, and goal alignment.
    Returns a 1–10 score with a rationale for each dimension plus an overall score.
    """
    if current_user.credits < 5:
        raise HTTPException(
            status_code=402,
            detail="Insufficient credits. 5 credits required per run.",
        )
    current_user.credits -= 5
    await db.flush()

    service = PromptService(db=db)
    result = await service.health_score(
        prompt=request.prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptHealthScoreResponse(**result))


@router.post("/advisory", response_model=SuccessResponse[PromptAdvisoryResponse])
async def prompt_advisory(
    request: PromptAdvisoryRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptAdvisoryResponse]:
    """
    Get a detailed advisory review of a prompt.
    Returns specific strengths, weaknesses, actionable improvements,
    and an overall assessment of the prompt's effectiveness.
    """
    if current_user.credits < 5:
        raise HTTPException(
            status_code=402,
            detail="Insufficient credits. 5 credits required per run.",
        )
    current_user.credits -= 5
    await db.flush()

    service = PromptService(db=db)
    result = await service.advisory(
        prompt=request.prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptAdvisoryResponse(**result))


# ---------------------------------------------------------------------------
# Versioning endpoints
# ---------------------------------------------------------------------------


@router.get("/versions", response_model=SuccessResponse[PromptFamilyListResponse])
async def list_prompt_families(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptFamilyListResponse]:
    """
    List all prompt families (grouped by prompt_id) belonging to the current user,
    each with their full version history in ascending order.
    """
    service = PromptVersioningService(db=db)
    families = await service.list_families(user_id=str(current_user.id))
    return SuccessResponse(data=PromptFamilyListResponse(families=families))


@router.post("/versions", response_model=SuccessResponse[PromptVersionCreateResponse])
async def create_prompt_version(
    request: PromptVersionCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptVersionCreateResponse]:
    """
    Register a named prompt and save it as version 1.
    Returns a `prompt_id` that uniquely identifies this prompt family
    across all future versions.
    """
    service = PromptVersioningService(db=db)
    result = await service.create(
        name=request.name,
        content=request.prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptVersionCreateResponse(**result))


@router.get(
    "/versions/{prompt_id}",
    response_model=SuccessResponse[PromptVersionListResponse],
)
async def list_prompt_versions(
    prompt_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptVersionListResponse]:
    """
    List all versions of a named prompt in ascending order (v1, v2, v3, …).
    """
    service = PromptVersioningService(db=db)
    result = await service.list_versions(
        prompt_id=prompt_id,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptVersionListResponse(**result))
