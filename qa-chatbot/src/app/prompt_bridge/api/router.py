"""
PromptBridge API routes.

POST  /prompt-bridge/transfer          Submit a transfer job (5 credits full, 1 credit reuse)
GET   /prompt-bridge/jobs/{job_id}     Poll job status + result
GET   /prompt-bridge/jobs              List user's transfer jobs
GET   /prompt-bridge/mappings          List user's saved model-pair mappings
GET   /prompt-bridge/mappings/{id}     Get mapping detail with prompt pairs
DELETE /prompt-bridge/mappings/{id}    Delete a mapping
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.prompt_bridge.api.exceptions import (
    PBInsufficientCreditsException,
    PBJobNotFoundException,
    PBMappingNotFoundException,
    PBSameModelException,
)
from app.prompt_bridge.api.schemas import (
    DeleteMappingResponse,
    MappingListResponse,
    PromptMappingDetailResponse,
    PromptMappingResponse,
    TransferJobCreatedResponse,
    TransferJobListResponse,
    TransferJobPollResponse,
    TransferJobSummary,
    TransferRequest,
    TransferResultPayload,
)
from app.prompt_bridge.data.models import TransferJob, TransferJobStatus
from app.prompt_bridge.data.repository import PromptMappingRepository, TransferJobRepository
from app.prompt_bridge.infrastructure.cache import (
    get_pb_job_owner,
    get_pb_job_progress,
    get_pb_job_result,
    get_pb_job_status,
    set_pb_job_owner,
    set_pb_job_status,
)
from app.prompt_bridge.workers.tasks import run_prompt_transfer
from app.repositories.user_repo import UserRepository

router = APIRouter(prefix="/prompt-bridge", tags=["prompt-bridge"])

_write_limiter = RateLimiter(requests=10, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)

_FULL_TRANSFER_COST = 5
_REUSE_TRANSFER_COST = 1


@router.post(
    "/transfer",
    response_model=SuccessResponse[TransferJobCreatedResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def submit_transfer(
    body: TransferRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[TransferJobCreatedResponse]:
    """
    Submit a prompt transfer request.

    Transfers source_prompt (optimised for source_model) to target_model.

    - First-time transfer between a model pair: runs full MAP-RPE calibration
      (5 credits). Builds a reusable mapping stored in the database.
    - Subsequent transfers for the same model pair: reuses the saved mapping
      and runs only the adapter step (1 credit).

    Returns HTTP 202 with job_id. Poll GET /jobs/{job_id} for the result.
    """
    if body.source_model == body.target_model:
        raise PBSameModelException()

    mapping_repo = PromptMappingRepository(db)
    existing_mapping = await mapping_repo.find_by_model_pair(
        current_user.id, body.source_model, body.target_model
    )

    reused = existing_mapping is not None
    cost = _REUSE_TRANSFER_COST if reused else _FULL_TRANSFER_COST

    if current_user.credits < cost:
        raise PBInsufficientCreditsException(required=cost)

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, cost)
    if not deducted:
        raise PBInsufficientCreditsException(required=cost)

    job_repo = TransferJobRepository(db)
    job = await job_repo.create(
        user_id=current_user.id,
        source_prompt=body.source_prompt,
        source_model=body.source_model,
        target_model=body.target_model,
        status=TransferJobStatus.queued,
        mapping_id=existing_mapping.id if existing_mapping else None,
        reused_mapping=reused,
        credits_charged=cost,
    )
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_pb_job_status(job_id, "queued")
    await set_pb_job_owner(job_id, str(current_user.id))

    run_prompt_transfer.apply_async(
        kwargs={
            "job_id": job_id,
            "transfer_job_id": str(job.id),
            "user_id": str(current_user.id),
            "source_prompt": body.source_prompt,
            "source_model": body.source_model,
            "target_model": body.target_model,
            "existing_mapping_id": str(existing_mapping.id) if existing_mapping else None,
        }
    )

    msg = (
        "Reusing existing mapping — adapter-only run (1 credit)."
        if reused
        else "Full calibration run started (5 credits)."
    )
    return SuccessResponse(
        data=TransferJobCreatedResponse(
            job_id=job_id,
            reused_mapping=reused,
            credits_charged=cost,
            message=msg,
        )
    )


@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[TransferJobPollResponse],
    dependencies=[Depends(_read_limiter)],
)
async def poll_transfer_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[TransferJobPollResponse]:
    """Poll a transfer job for status, progress, and result."""
    owner = await get_pb_job_owner(job_id)
    if owner is None or owner != str(current_user.id):
        raise PBJobNotFoundException()

    job_status = await get_pb_job_status(job_id)
    if job_status is None:
        raise PBJobNotFoundException()

    progress = await get_pb_job_progress(job_id)
    result_payload: TransferResultPayload | None = None
    error: str | None = None

    if job_status == "completed":
        raw = await get_pb_job_result(job_id)
        if raw:
            result_payload = TransferResultPayload(**raw)
    elif job_status == "failed":
        raw = await get_pb_job_result(job_id)
        if raw:
            error = str(raw.get("error", "Unknown error"))

    return SuccessResponse(
        data=TransferJobPollResponse(
            job_id=job_id,
            status=job_status,
            stage=str(progress.get("stage")) if progress else None,
            progress=progress,
            result=result_payload,
            error=error,
        )
    )


@router.get(
    "/jobs",
    response_model=SuccessResponse[TransferJobListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_transfer_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[TransferJobListResponse]:
    """List the current user's transfer jobs (newest first, max 50)."""
    repo = TransferJobRepository(db)
    jobs: list[TransferJob] = await repo.get_by_user(current_user.id)
    return SuccessResponse(
        data=TransferJobListResponse(jobs=[TransferJobSummary.model_validate(j) for j in jobs])
    )


@router.get(
    "/mappings",
    response_model=SuccessResponse[MappingListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_mappings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[MappingListResponse]:
    """List all saved source→target transfer mappings for the current user."""
    repo = PromptMappingRepository(db)
    mappings = await repo.get_by_user(current_user.id)
    return SuccessResponse(
        data=MappingListResponse(
            mappings=[PromptMappingResponse.model_validate(m) for m in mappings]
        )
    )


@router.get(
    "/mappings/{mapping_id}",
    response_model=SuccessResponse[PromptMappingDetailResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_mapping(
    mapping_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[PromptMappingDetailResponse]:
    """Get a specific mapping including all calibrated prompt pairs."""
    repo = PromptMappingRepository(db)
    mapping = await repo.get_by_id_and_user(mapping_id, current_user.id)
    if mapping is None:
        raise PBMappingNotFoundException()
    return SuccessResponse(data=PromptMappingDetailResponse.model_validate(mapping))


@router.delete(
    "/mappings/{mapping_id}",
    response_model=SuccessResponse[DeleteMappingResponse],
    dependencies=[Depends(_write_limiter)],
)
async def delete_mapping(
    mapping_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DeleteMappingResponse]:
    """Delete a saved mapping and all its calibrated prompt pairs."""
    repo = PromptMappingRepository(db)
    deleted = await repo.delete_by_id_and_user(mapping_id, current_user.id)
    if not deleted:
        raise PBMappingNotFoundException()
    await db.commit()
    return SuccessResponse(data=DeleteMappingResponse(mapping_id=mapping_id, deleted=True))
