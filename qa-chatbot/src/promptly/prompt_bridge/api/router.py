"""
PromptBridge API routes.

POST   /prompt-bridge/transfer            Submit a transfer job (5 credits full, 1 credit reuse)
GET    /prompt-bridge/jobs/{job_id}       Poll job status + result
POST   /prompt-bridge/jobs/{job_id}/cancel Cancel a queued/running job + refund credits
GET    /prompt-bridge/jobs                List user's transfer jobs
GET    /prompt-bridge/mappings            List user's saved model-pair mappings
GET    /prompt-bridge/mappings/{id}       Get mapping detail with prompt pairs
DELETE /prompt-bridge/mappings/{id}       Delete a mapping + all its pairs
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.prompt_bridge.api.exceptions import (
    PBInsufficientCreditsException,
    PBJobNotCancellableException,
    PBJobNotFoundException,
    PBMappingNotFoundException,
    PBSameModelException,
)
from promptly.prompt_bridge.api.schemas import (
    CancelJobResponse,
    DeleteJobResponse,
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
from promptly.prompt_bridge.data.models import TransferJob, TransferJobStatus
from promptly.prompt_bridge.data.repository import PromptMappingRepository, TransferJobRepository
from promptly.prompt_bridge.infrastructure.cache import (
    get_pb_celery_task_id,
    get_pb_job_owner,
    get_pb_job_progress,
    get_pb_job_result,
    get_pb_job_status,
    set_pb_celery_task_id,
    set_pb_job_cancel,
    set_pb_job_owner,
    set_pb_job_result,
    set_pb_job_status,
)
from promptly.prompt_bridge.workers.tasks import run_prompt_transfer
from promptly.repositories.usage_event_repo import UsageEventRepository
from promptly.repositories.user_repo import UserRepository
from promptly.utils.log import get_logger
from promptly.workers.celery_app import celery_app

log = get_logger(__name__)

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
    current_user: Annotated[UserContext, Depends(get_current_user)],
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
        current_user.user_id, body.source_model, body.target_model
    )

    reused = existing_mapping is not None
    cost = _REUSE_TRANSFER_COST if reused else _FULL_TRANSFER_COST

    if current_user.credits < cost:
        log.warning("insufficient_credits", required=cost, available=current_user.credits)
        raise PBInsufficientCreditsException(required=cost)

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.user_id, cost)
    if not deducted:
        raise PBInsufficientCreditsException(required=cost)

    job_id = str(uuid.uuid4())

    job_repo = TransferJobRepository(db)
    job = await job_repo.create(
        user_id=current_user.user_id,
        source_prompt=body.source_prompt,
        source_model=body.source_model,
        target_model=body.target_model,
        status=TransferJobStatus.queued,
        mapping_id=existing_mapping.id if existing_mapping else None,
        reused_mapping=reused,
        credits_charged=cost,
        redis_job_id=job_id,
    )
    await set_pb_job_status(job_id, "queued")
    await set_pb_job_owner(job_id, str(current_user.user_id))

    celery_result = run_prompt_transfer.apply_async(
        kwargs={
            "job_id": job_id,
            "transfer_job_id": str(job.id),
            "user_id": str(current_user.user_id),
            "source_prompt": body.source_prompt,
            "source_model": body.source_model,
            "target_model": body.target_model,
            "existing_mapping_id": str(existing_mapping.id) if existing_mapping else None,
        }
    )
    usage_repo = UsageEventRepository(db)
    await usage_repo.log(user_id=current_user.user_id, action="bridge", credits_spent=cost)
    await db.commit()
    await set_pb_celery_task_id(job_id, celery_result.id)
    log.info(
        "transfer_job_queued",
        job_id=job_id,
        source_model=body.source_model,
        target_model=body.target_model,
        reused=reused,
        credits=cost,
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
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[TransferJobPollResponse]:
    """Poll a transfer job for status, progress, and result."""
    owner = await get_pb_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
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
            raw_error = raw.get("error")
            error = str(raw_error) if raw_error is not None else "Unknown error"

    return SuccessResponse(
        data=TransferJobPollResponse(
            job_id=job_id,
            status=job_status,
            stage=str(progress["stage"]) if progress and "stage" in progress else None,
            progress=progress,
            result=result_payload,
            error=error,
        )
    )


@router.post(
    "/jobs/{db_job_id}/cancel-by-id",
    response_model=SuccessResponse[CancelJobResponse],
    dependencies=[Depends(_write_limiter)],
)
async def cancel_transfer_job_by_db_id(
    db_job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CancelJobResponse]:
    """
    Cancel a job using its DB UUID (usable after page reload when Redis job_id is unknown).

    Looks up the redis_job_id stored on the DB record and delegates to the same
    two-pronged cancellation logic as the Redis-key-based cancel endpoint.
    """
    job_repo = TransferJobRepository(db)
    job = await job_repo.get_by_id_and_user(db_job_id, current_user.user_id)
    if job is None:
        raise PBJobNotFoundException()
    terminal = (TransferJobStatus.completed, TransferJobStatus.failed, TransferJobStatus.cancelled)
    if job.status in terminal:
        raise PBJobNotCancellableException()

    redis_id = job.redis_job_id
    if redis_id is None:
        # No redis_job_id stored — just mark cancelled in DB and refund
        await job_repo.set_status(
            job, TransferJobStatus.cancelled, error_message="Cancelled by user."
        )
        user_repo = UserRepository(db)
        await user_repo.refund_credits(current_user.user_id, job.credits_charged)
        await db.commit()
        log.info("transfer_job_cancelled", job_id=str(db_job_id))
        return SuccessResponse(data=CancelJobResponse(job_id=str(db_job_id), cancelled=True))

    # Revoke from broker
    celery_task_id = await get_pb_celery_task_id(redis_id)
    if celery_task_id:
        from celery.result import AsyncResult

        _ar = AsyncResult(celery_task_id, app=celery_app)
        await asyncio.to_thread(lambda: _ar.revoke(terminate=True, signal="SIGTERM"))

    await set_pb_job_cancel(redis_id)
    await set_pb_job_status(redis_id, "cancelled")
    await set_pb_job_result(redis_id, {"error": "Cancelled by user."})

    await job_repo.set_status(job, TransferJobStatus.cancelled, error_message="Cancelled by user.")
    user_repo = UserRepository(db)
    await user_repo.refund_credits(current_user.user_id, job.credits_charged)
    await db.commit()
    log.info("transfer_job_cancelled", job_id=str(db_job_id))

    return SuccessResponse(data=CancelJobResponse(job_id=str(db_job_id), cancelled=True))


@router.delete(
    "/jobs/{job_id}",
    response_model=SuccessResponse[DeleteJobResponse],
    dependencies=[Depends(_write_limiter)],
)
async def delete_transfer_job(
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DeleteJobResponse]:
    """
    Delete a completed or failed transfer job record.

    Only non-running jobs (completed, failed, cancelled) can be deleted.
    Running jobs must be cancelled first via POST /jobs/{job_id}/cancel.
    """
    job_repo = TransferJobRepository(db)
    job = await job_repo.get_by_id_and_user(job_id, current_user.user_id)
    if job is None:
        raise PBJobNotFoundException()
    if job.status not in (
        TransferJobStatus.completed,
        TransferJobStatus.failed,
        TransferJobStatus.cancelled,
    ):
        raise PBJobNotCancellableException()
    deleted = await job_repo.delete_by_id_and_user(job_id, current_user.user_id)
    await db.commit()
    return SuccessResponse(data=DeleteJobResponse(job_id=job_id, deleted=deleted))


@router.get(
    "/jobs",
    response_model=SuccessResponse[TransferJobListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_transfer_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[TransferJobListResponse]:
    """List the current user's transfer jobs (newest first, max 50)."""
    repo = TransferJobRepository(db)
    jobs: list[TransferJob] = await repo.get_by_user(current_user.user_id)
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
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[MappingListResponse]:
    """List all saved source→target transfer mappings for the current user."""
    repo = PromptMappingRepository(db)
    mappings = await repo.get_by_user(current_user.user_id)
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
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[PromptMappingDetailResponse]:
    """Get a specific mapping including all calibrated prompt pairs."""
    repo = PromptMappingRepository(db)
    mapping = await repo.get_by_id_and_user(mapping_id, current_user.user_id)
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
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DeleteMappingResponse]:
    """Delete a saved mapping and all its calibrated prompt pairs."""
    repo = PromptMappingRepository(db)
    deleted = await repo.delete_by_id_and_user(mapping_id, current_user.user_id)
    if not deleted:
        raise PBMappingNotFoundException()
    await db.commit()
    log.info("mapping_deleted", mapping_id=str(mapping_id))
    return SuccessResponse(data=DeleteMappingResponse(mapping_id=mapping_id, deleted=True))


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=SuccessResponse[CancelJobResponse],
    dependencies=[Depends(_write_limiter)],
)
async def cancel_transfer_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CancelJobResponse]:
    """
    Cancel a queued or in-progress transfer job.

    Two-pronged cancellation:
      1. Revoke the Celery task from the Redis broker queue (removes it if still
         queued; sends SIGTERM if already running, with terminate=True).
      2. Set a Redis cancel flag that the worker checks at each inter-stage
         checkpoint so it stops cleanly even if revoke arrives mid-execution.

    Credits are refunded immediately via the DB record.
    Returns 409 if the job is already completed, failed, or cancelled.
    """
    owner = await get_pb_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise PBJobNotFoundException()

    current_status = await get_pb_job_status(job_id)
    if current_status is None:
        raise PBJobNotFoundException()
    if current_status in ("completed", "failed", "cancelled"):
        raise PBJobNotCancellableException()

    # ── 1. Revoke from the broker (Redis queue) ────────────────────────────
    # terminate=True sends SIGTERM to the worker process if the task is already
    # executing; signal="SIGKILL" is intentionally avoided to let the worker
    # clean up its own DB/Redis state.  If the task is still queued (not yet
    # picked up) revoke() removes it from the Redis list entirely.
    celery_task_id = await get_pb_celery_task_id(job_id)
    if celery_task_id:
        from celery.result import AsyncResult

        _ar = AsyncResult(celery_task_id, app=celery_app)
        await asyncio.to_thread(lambda: _ar.revoke(terminate=True, signal="SIGTERM"))

    # ── 2. Set cooperative cancel flag for the inter-stage checkpoints ──────
    await set_pb_job_cancel(job_id)

    # ── 3. Update Redis job state immediately ──────────────────────────────
    await set_pb_job_status(job_id, "cancelled")
    await set_pb_job_result(job_id, {"error": "Cancelled by user."})

    # ── 4. Persist cancellation + refund credits in DB ─────────────────────
    job_repo = TransferJobRepository(db)
    matching = await job_repo.get_by_redis_job_id(job_id, current_user.user_id)
    if matching is not None:
        await job_repo.set_status(
            matching,
            TransferJobStatus.cancelled,
            error_message="Cancelled by user.",
        )
        user_repo = UserRepository(db)
        await user_repo.refund_credits(current_user.user_id, matching.credits_charged)
        await db.commit()

    log.info("transfer_job_cancelled", job_id=job_id)
    return SuccessResponse(data=CancelJobResponse(job_id=job_id, cancelled=True))
