import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.api.v1.exceptions.prompts import (
    PromptInsufficientCreditsException,
    PromptVersionNotFoundException,
)
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.repositories.prompt_version_repo import PromptVersionRepository
from promptly.repositories.usage_event_repo import UsageEventRepository
from promptly.repositories.user_repo import UserRepository
from promptly.schemas.prompt import (
    PaginatedPromptFamilyListResponse,
    PromptAdvisoryRequest,
    PromptAdvisoryResponse,
    PromptDiffResponse,
    PromptHealthScoreRequest,
    PromptHealthScoreResponse,
    PromptVersionCreateRequest,
    PromptVersionCreateResponse,
    PromptVersionListResponse,
)
from promptly.services.prompt_service import PromptService, PromptVersioningService
from promptly.utils.diff import compute_diff
from promptly.utils.log import get_logger

log = get_logger(__name__)

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
    summary="Score prompt quality",
    description="Evaluate a prompt across eight quality dimensions (clarity, specificity, completeness, conciseness, tone, actionability, context richness, goal alignment). Returns a 1–10 score with rationale for each dimension.",  # noqa: E501
    responses=error_responses(401, 402, 422, 429, 500),
)
async def prompt_health_score(
    request: PromptHealthScoreRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[PromptHealthScoreResponse]:
    """
    Score a prompt across eight quality dimensions: clarity, specificity, completeness,
    conciseness, tone, actionability, context richness, and goal alignment.
    Returns a 1–10 score with a rationale for each dimension plus an overall score.
    """
    user_repo = UserRepository(db)
    if not await user_repo.has_min_tokens(current_user.user_id):
        raise PromptInsufficientCreditsException()

    log.info("health_score_requested")
    service = PromptService(db=db)
    result = await service.health_score(
        prompt=request.prompt,
        user_id=str(current_user.user_id),
    )

    token_count = result.pop("_token_usage", 0)
    if token_count:
        await user_repo.deduct_tokens(current_user.user_id, token_count)

    usage_repo = UsageEventRepository(db)
    await usage_repo.log(
        user_id=current_user.user_id, action="health_score", credits_spent=token_count
    )
    await db.commit()

    return SuccessResponse(data=PromptHealthScoreResponse(**result))


@router.post(
    "/advisory",
    response_model=SuccessResponse[PromptAdvisoryResponse],
    dependencies=[Depends(_expensive_limiter)],
    summary="Advisory review",
    description="Return a detailed qualitative review of a prompt: strengths, weaknesses, actionable improvements, and dimension-level scores.",  # noqa: E501
    responses=error_responses(401, 402, 422, 429, 500),
)
async def prompt_advisory(
    request: PromptAdvisoryRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[PromptAdvisoryResponse]:
    """
    Get a detailed advisory review of a prompt.
    Returns specific strengths, weaknesses, actionable improvements,
    and an overall assessment of the prompt's effectiveness.
    """
    user_repo = UserRepository(db)
    if not await user_repo.has_min_tokens(current_user.user_id):
        raise PromptInsufficientCreditsException()

    log.info("advisory_requested")
    service = PromptService(db=db)
    result = await service.advisory(
        prompt=request.prompt,
        user_id=str(current_user.user_id),
    )

    token_count = result.pop("_token_usage", 0)
    if token_count:
        await user_repo.deduct_tokens(current_user.user_id, token_count)

    usage_repo = UsageEventRepository(db)
    await usage_repo.log(user_id=current_user.user_id, action="advisory", credits_spent=token_count)
    await db.commit()

    return SuccessResponse(data=PromptAdvisoryResponse(**result))


# ---------------------------------------------------------------------------
# Versioning endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/versions",
    response_model=SuccessResponse[PaginatedPromptFamilyListResponse],
    dependencies=[Depends(_default_limiter)],
    summary="List prompt families",
    description="Return a paginated list of versioned prompt families owned by the current user.",
    responses=error_responses(401, 429, 500),
)
async def list_prompt_families(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SuccessResponse[PaginatedPromptFamilyListResponse]:
    """
    List prompt families (grouped by prompt_id) for the current user,
    most-recently updated first, with pagination.
    """
    service = PromptVersioningService(db=db)
    result = await service.list_families(
        user_id=str(current_user.user_id), page=page, page_size=page_size
    )
    return SuccessResponse(data=PaginatedPromptFamilyListResponse(**result))


@router.post(
    "/versions",
    response_model=SuccessResponse[PromptVersionCreateResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Create prompt version",
    description="Save a new version under an existing or new prompt family.",
    responses=error_responses(401, 404, 422, 429, 500),
)
async def create_prompt_version(
    request: PromptVersionCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
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
        user_id=str(current_user.user_id),
    )
    return SuccessResponse(data=PromptVersionCreateResponse(**result))


@router.get(
    "/versions/{prompt_id}",
    response_model=SuccessResponse[PromptVersionListResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Get prompt versions",
    description="List all versions belonging to a specific prompt family.",
    responses=error_responses(401, 404, 429, 500),
)
async def list_prompt_versions(
    prompt_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[PromptVersionListResponse]:
    """
    List all versions of a named prompt in ascending order (v1, v2, v3, …).
    """
    service = PromptVersioningService(db=db)
    result = await service.list_versions(
        prompt_id=prompt_id,
        user_id=str(current_user.user_id),
    )
    return SuccessResponse(data=PromptVersionListResponse(**result))


@router.get(
    "/versions/{prompt_id}/diff",
    response_model=SuccessResponse[PromptDiffResponse],
    dependencies=[Depends(_default_limiter)],
    summary="Compute prompt diff",
    description="Return a structured diff between two versions of a prompt.",
    responses=error_responses(401, 404, 429, 500),
)
async def diff_prompt_versions(
    prompt_id: uuid.UUID,
    from_version: int = Query(..., alias="from", ge=1),
    to_version: int = Query(..., alias="to", ge=1),
    db: Annotated[AsyncSession, Depends(get_db)] = ...,  # type: ignore[assignment]
    current_user: Annotated[UserContext, Depends(get_current_user)] = ...,  # type: ignore[assignment]
) -> SuccessResponse[PromptDiffResponse]:
    """
    Return a word-level diff between two versions of a prompt family.
    Query params: from=<version_number>&to=<version_number>
    Both versions must belong to the current user.
    """
    repo = PromptVersionRepository(db)
    from_pv = await repo.get_by_version_number(prompt_id, from_version, current_user.user_id)
    to_pv = await repo.get_by_version_number(prompt_id, to_version, current_user.user_id)

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
