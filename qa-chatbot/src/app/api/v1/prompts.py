import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.prompts import (
    PromptInsufficientCreditsException,
    PromptVersionNotFoundException,
)
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.prompt_version_repo import PromptVersionRepository
from app.schemas.prompt import (
    PromptAdvisoryRequest,
    PromptAdvisoryResponse,
    PromptDiffResponse,
    PromptFamilyListResponse,
    PromptHealthScoreRequest,
    PromptHealthScoreResponse,
    PromptVersionCreateRequest,
    PromptVersionCreateResponse,
    PromptVersionListResponse,
)
from app.service.prompt_service import PromptService, PromptVersioningService
from app.utils.diff import compute_diff

_expensive_limiter = RateLimiter(requests=20, window_seconds=60)
_default_limiter = RateLimiter(requests=60, window_seconds=60)

router = APIRouter(prefix="/prompts", tags=["prompts"])


# ---------------------------------------------------------------------------
# Analysis endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/health-score",
    response_model=SuccessResponse[PromptHealthScoreResponse],
    dependencies=[Depends(_expensive_limiter)],
)
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
        raise PromptInsufficientCreditsException()
    current_user.credits -= 5
    await db.flush()

    service = PromptService(db=db)
    result = await service.health_score(
        prompt=request.prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptHealthScoreResponse(**result))


@router.post(
    "/advisory",
    response_model=SuccessResponse[PromptAdvisoryResponse],
    dependencies=[Depends(_expensive_limiter)],
)
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
        raise PromptInsufficientCreditsException()
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


@router.get(
    "/versions",
    response_model=SuccessResponse[PromptFamilyListResponse],
    dependencies=[Depends(_default_limiter)],
)
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


@router.post(
    "/versions",
    response_model=SuccessResponse[PromptVersionCreateResponse],
    dependencies=[Depends(_default_limiter)],
)
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
    dependencies=[Depends(_default_limiter)],
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


@router.get(
    "/versions/{prompt_id}/diff",
    response_model=SuccessResponse[PromptDiffResponse],
    dependencies=[Depends(_default_limiter)],
)
async def diff_prompt_versions(
    prompt_id: uuid.UUID,
    from_version: int = Query(..., alias="from", ge=1),
    to_version: int = Query(..., alias="to", ge=1),
    db: Annotated[AsyncSession, Depends(get_db)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(get_current_user)] = ...,  # type: ignore[assignment]
) -> SuccessResponse[PromptDiffResponse]:
    """
    Return a word-level diff between two versions of a prompt family.
    Query params: from=<version_number>&to=<version_number>
    Both versions must belong to the current user.
    """
    repo = PromptVersionRepository(db)
    from_pv = await repo.get_by_version_number(prompt_id, from_version, current_user.id)
    to_pv = await repo.get_by_version_number(prompt_id, to_version, current_user.id)

    if from_pv is None or to_pv is None:
        raise PromptVersionNotFoundException()

    hunks, stats = compute_diff(from_pv.content, to_pv.content)

    return SuccessResponse(
        data=PromptDiffResponse(
            prompt_id=str(prompt_id),
            from_version=from_version,
            to_version=to_version,
            from_content=from_pv.content,
            to_content=to_pv.content,
            hunks=[
                {"type": h.type, "text": h.text, "from_text": h.from_text, "to_text": h.to_text}
                for h in hunks
            ],
            stats=stats,
        )
    )
