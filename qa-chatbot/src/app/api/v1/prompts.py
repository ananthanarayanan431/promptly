import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db, get_graph
from app.models.user import User
from app.schemas.prompt import (
    PromptAdvisoryRequest,
    PromptAdvisoryResponse,
    PromptHealthScoreRequest,
    PromptHealthScoreResponse,
    PromptVersionCreateRequest,
    PromptVersionCreateResponse,
    PromptVersionListResponse,
    PromptVersionOptimizeRequest,
    PromptVersionOptimizeResponse,
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

    service = PromptService(db=db)
    result = await service.advisory(
        prompt=request.prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptAdvisoryResponse(**result))


# ---------------------------------------------------------------------------
# Versioning endpoints
# ---------------------------------------------------------------------------


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


@router.post(
    "/versions/{prompt_id}/optimize",
    response_model=SuccessResponse[PromptVersionOptimizeResponse],
)
async def optimize_prompt_version(
    prompt_id: uuid.UUID,
    request: PromptVersionOptimizeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    graph: Annotated[Any, Depends(get_graph)],  # noqa: ANN401
) -> SuccessResponse[PromptVersionOptimizeResponse]:
    """
    Optimize the latest version of a named prompt through the full council pipeline
    and save the result as the next version (v1→v2, v2→v3, …).

    Optionally supply `feedback` to steer how the council optimizes the prompt
    (e.g. "keep it under 50 words", "add a JSON output format").
    Costs 10 credits — same as a standard optimization run.
    """
    if current_user.credits < 10:
        raise HTTPException(
            status_code=402,
            detail="Insufficient credits. 10 credits required per run.",
        )
    current_user.credits -= 10

    service = PromptVersioningService(db=db)
    result = await service.optimize(
        prompt_id=prompt_id,
        user_id=str(current_user.id),
        feedback=request.feedback,
        graph=graph,
    )
    return SuccessResponse(data=PromptVersionOptimizeResponse(**result))


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
