"""SkillOpt FastAPI router."""

from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse
from promptly.config.env import get_minio_settings
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.repositories.user_repo import UserRepository
from promptly.skill_opt.api.exceptions import (
    SkillOptAlreadyRunningError,
    SkillOptInsufficientCreditsError,
    SkillOptJobNotFoundError,
    SkillOptNoExamplesError,
    SkillOptProjectNotFoundError,
)
from promptly.skill_opt.api.schemas import (
    CreateSkillProjectRequest,
    DeleteSkillProjectResponse,
    OptimizeSkillRequest,
    SetExamplesRequest,
    SkillEditItem,
    SkillExamplesResponse,
    SkillJobPollResponse,
    SkillJobResponse,
    SkillOptLiveState,
    SkillOptLiveStateResponse,
    SkillProjectListResponse,
    SkillProjectResponse,
    SkillRunListResponse,
    SkillRunResponse,
)
from promptly.skill_opt.data.models import SkillOptStatus
from promptly.skill_opt.data.repository import SkillOptProjectRepository
from promptly.skill_opt.infrastructure.cache import (
    get_so_job_owner,
    get_so_job_result,
    get_so_job_status,
    get_so_live_state,
    set_so_job_owner,
    set_so_job_project_id,
    set_so_job_status,
)
from promptly.skill_opt.infrastructure.storage import (
    download_text,
    examples_key,
    upload_text,
)
from promptly.skill_opt.workers.tasks import run_skillopt
from promptly.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/skill-opt", tags=["skill-opt"])

_CREDIT_COST = {"low": 5, "medium": 10, "high": 16}

_write_limiter = RateLimiter(requests=10, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)


# ── Projects CRUD ─────────────────────────────────────────────────────────────


@router.post(
    "/",
    response_model=SuccessResponse[SkillProjectResponse],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_write_limiter)],
)
async def create_project(
    body: CreateSkillProjectRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillProjectResponse]:
    """Create a new Skill project."""
    repo = SkillOptProjectRepository(db)
    project = await repo.create(
        user_id=current_user.user_id,
        name=body.name.strip(),
        task_description=body.task_description.strip(),
        description=body.description.strip() if body.description else None,
    )
    await db.commit()
    await db.refresh(project)
    return SuccessResponse(data=SkillProjectResponse.model_validate(project))


@router.get(
    "/",
    response_model=SuccessResponse[SkillProjectListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillProjectListResponse]:
    repo = SkillOptProjectRepository(db)
    projects = await repo.get_by_user(current_user.user_id)
    return SuccessResponse(
        data=SkillProjectListResponse(
            projects=[SkillProjectResponse.model_validate(p) for p in projects]
        )
    )


@router.get(
    "/{project_id}",
    response_model=SuccessResponse[SkillProjectResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillProjectResponse]:
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()
    return SuccessResponse(data=SkillProjectResponse.model_validate(project))


@router.delete(
    "/{project_id}",
    response_model=SuccessResponse[DeleteSkillProjectResponse],
    dependencies=[Depends(_write_limiter)],
)
async def delete_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DeleteSkillProjectResponse]:
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()
    await repo.delete(project)
    await db.commit()
    return SuccessResponse(data=DeleteSkillProjectResponse(project_id=project_id))


# ── Examples ──────────────────────────────────────────────────────────────────


@router.post(
    "/{project_id}/examples",
    response_model=SuccessResponse[SkillExamplesResponse],
    dependencies=[Depends(_write_limiter)],
)
async def set_examples(
    project_id: uuid.UUID,
    body: SetExamplesRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillExamplesResponse]:
    """Upload / replace Q&A examples for a project."""
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()

    minio_cfg = get_minio_settings()
    jsonl = "\n".join(
        json.dumps({"input": ex.input, "expected": ex.expected}) for ex in body.examples
    )
    upload_text(
        minio_cfg.MINIO_BUCKET_NAME,
        examples_key(str(current_user.user_id), str(project_id)),
        jsonl,
    )

    await repo.set_status(project, project.status, example_count=len(body.examples))
    await db.commit()

    return SuccessResponse(
        data=SkillExamplesResponse(examples=body.examples, count=len(body.examples))
    )


@router.get(
    "/{project_id}/examples",
    response_model=SuccessResponse[SkillExamplesResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_examples(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillExamplesResponse]:
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()

    try:
        minio_cfg = get_minio_settings()
        jsonl = download_text(
            minio_cfg.MINIO_BUCKET_NAME,
            examples_key(str(current_user.user_id), str(project_id)),
        )
        from promptly.skill_opt.api.schemas import SkillExample

        examples = []
        for line in jsonl.strip().splitlines():
            obj = json.loads(line)
            examples.append(SkillExample(input=obj["input"], expected=obj["expected"]))
    except Exception:  # noqa: BLE001
        examples = []

    return SuccessResponse(data=SkillExamplesResponse(examples=examples, count=len(examples)))


# ── Optimization ──────────────────────────────────────────────────────────────


@router.post(
    "/{project_id}/optimize",
    response_model=SuccessResponse[SkillJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def start_optimization(
    project_id: uuid.UUID,
    body: OptimizeSkillRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillJobResponse]:
    """Start a SkillOpt optimization job."""
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()

    if project.status == SkillOptStatus.optimizing:
        raise SkillOptAlreadyRunningError()

    if not project.example_count or project.example_count < 6:
        raise SkillOptNoExamplesError()

    credit_cost = _CREDIT_COST.get(body.budget_tier, 10)
    if current_user.credits < credit_cost:
        raise SkillOptInsufficientCreditsError()

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.user_id, credit_cost)
    if not deducted:
        raise SkillOptInsufficientCreditsError()

    await repo.set_status(project, SkillOptStatus.optimizing, example_count=project.example_count)
    project.credits_charged = credit_cost
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_so_job_status(job_id, "queued")
    await set_so_job_owner(job_id, str(current_user.user_id))
    await set_so_job_project_id(job_id, str(project_id))

    run_skillopt.apply_async(
        kwargs={
            "job_id": job_id,
            "project_id": str(project_id),
            "user_id": str(current_user.user_id),
            "budget_tier": body.budget_tier,
        }
    )
    log.info("skillopt_job_queued", job_id=job_id, project_id=str(project_id))

    return SuccessResponse(data=SkillJobResponse(job_id=job_id, project_id=project_id))


# ── Job poll ──────────────────────────────────────────────────────────────────


@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[SkillJobPollResponse],
    dependencies=[Depends(_read_limiter)],
)
async def poll_job(
    job_id: str,
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillJobPollResponse]:
    owner = await get_so_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise SkillOptJobNotFoundError()

    job_status = await get_so_job_status(job_id)
    if job_status is None:
        raise SkillOptJobNotFoundError()

    result = None
    error = None
    if job_status == "completed":
        result = await get_so_job_result(job_id)
    elif job_status == "failed":
        raw = await get_so_job_result(job_id)
        error = (raw or {}).get("error", "Unknown error")

    return SuccessResponse(
        data=SkillJobPollResponse(
            job_id=job_id,
            status=job_status,
            result=result,
            error=error,
        )
    )


# ── Epoch runs ────────────────────────────────────────────────────────────────


@router.get(
    "/{project_id}/runs",
    response_model=SuccessResponse[SkillRunListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_runs(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillRunListResponse]:
    """Return all epoch runs for a project."""
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()
    runs = await repo.get_runs_by_project(project_id)
    return SuccessResponse(
        data=SkillRunListResponse(runs=[SkillRunResponse.model_validate(r) for r in runs])
    )


# ── Live state ────────────────────────────────────────────────────────────────


@router.get(
    "/{project_id}/state",
    response_model=SuccessResponse[SkillOptLiveStateResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_live_state(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SkillOptLiveStateResponse]:
    repo = SkillOptProjectRepository(db)
    project = await repo.get_by_id_and_user(project_id, current_user.user_id)
    if project is None:
        raise SkillOptProjectNotFoundError()

    raw = await get_so_live_state(str(project_id))
    if raw is None:
        return SuccessResponse(data=SkillOptLiveStateResponse(state=None))

    live = SkillOptLiveState(
        phase=raw.get("phase", ""),
        epoch=raw.get("epoch", 0),
        total_epochs=raw.get("total_epochs", 0),
        epoch_pct=raw.get("epoch_pct", 0.0),
        current_score=raw.get("current_score"),
        best_score=raw.get("best_score"),
        edits_accepted=raw.get("edits_accepted", 0),
        edits_rejected=raw.get("edits_rejected", 0),
        rollout_done=raw.get("rollout_done", 0),
        rollout_total=raw.get("rollout_total", 0),
        recent_edits=[SkillEditItem(**e) for e in raw.get("recent_edits", [])],
        current_skill_preview=raw.get("current_skill_preview", ""),
    )
    return SuccessResponse(data=SkillOptLiveStateResponse(state=live))
