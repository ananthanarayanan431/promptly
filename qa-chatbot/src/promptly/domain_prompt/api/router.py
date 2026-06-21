from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.config.env import get_minio_settings
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.domain_prompt.api.exceptions import (
    DomainAlreadyRunningException,
    DomainInsufficientCreditsException,
    DomainJobNotCancellableException,
    DomainJobNotFoundException,
    DomainNotFoundException,
    DomainNotReadyException,
    InvalidPDFException,
)
from promptly.domain_prompt.api.schemas import (
    AugmentDatasetRequest,
    CancelDomainJobResponse,
    CreateDomainJobResponse,
    DatasetRowsResponse,
    DeleteDomainResponse,
    DomainJobPollResponse,
    DomainListResponse,
    DomainPromptResponse,
    OptimizationRunResponse,
    OptimizeDomainRequest,
    QAPair,
    RunListResponse,
    TournamentStateResponse,
    UpdateDatasetRequest,
)
from promptly.domain_prompt.data.models import DomainPrompt, DomainPromptStatus
from promptly.domain_prompt.data.repository import (
    DomainOptimizationRunRepository,
    DomainPromptRepository,
)
from promptly.domain_prompt.infrastructure.cache import (
    clear_dp_domain_active_job,
    clear_dp_tournament_state,
    get_dp_celery_task_id,
    get_dp_domain_active_job,
    get_dp_job_domain_id,
    get_dp_job_owner,
    get_dp_job_result,
    get_dp_job_stage,
    get_dp_job_status,
    get_dp_tournament_state,
    set_dp_job_cancel,
    set_dp_job_owner,
    set_dp_job_result,
    set_dp_job_status,
)
from promptly.domain_prompt.infrastructure.storage import (
    delete_objects_with_prefix,
    download_text,
    object_key,
    upload_bytes,
    upload_text,
)
from promptly.domain_prompt.workers.tasks import (
    augment_domain_dataset,
    prepare_domain_dataset,
    run_domain_optimization,
)
from promptly.repositories.usage_event_repo import UsageEventRepository
from promptly.repositories.user_repo import UserRepository
from promptly.utils.log import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/domain-prompts", tags=["domain-prompts"])

_write_limiter = RateLimiter(requests=10, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)


def _to_response(domain: DomainPrompt) -> DomainPromptResponse:
    return DomainPromptResponse.model_validate(domain)


@router.get(
    "/",
    response_model=SuccessResponse[DomainListResponse],
    dependencies=[Depends(_read_limiter)],
    summary="List domain projects",
    description="Return all domain-prompt projects owned by the current user.",
    responses=error_responses(401, 429, 500),
)
async def list_domains(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DomainListResponse]:
    """List all domain prompts for the current user."""
    repo = DomainPromptRepository(db)
    domains = await repo.get_by_user(current_user.user_id)
    return SuccessResponse(data=DomainListResponse(domains=[_to_response(d) for d in domains]))


@router.post(
    "/",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
    summary="Create domain project",
    description="Upload a PDF to create a knowledge base. The PDF is parsed and a Q&A dataset is generated asynchronously. Costs tokens.",  # noqa: E501
    responses=error_responses(401, 402, 422, 429, 500),
)
async def create_domain(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
    name: Annotated[str, Form(min_length=1, max_length=120)],
    file: Annotated[UploadFile, File()],
    description: Annotated[str | None, Form(max_length=500)] = None,
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Create a domain knowledge base by uploading a PDF.

    The PDF is stored in MinIO and a Q&A dataset is generated from it.
    No prompt is needed here — submit prompts via POST /{domain_id}/optimize.

    Cost: billed post-completion by actual token usage.
    Returns HTTP 202 with a job_id to poll for progress.
    """
    user_repo = UserRepository(db)
    if not await user_repo.has_min_tokens(current_user.user_id):
        raise DomainInsufficientCreditsException()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise InvalidPDFException()

    _max_pdf_bytes = 100 * 1024 * 1024
    pdf_bytes = await file.read()
    if len(pdf_bytes) > _max_pdf_bytes:
        raise InvalidPDFException(detail="PDF file exceeds the 100 MB size limit.")
    if not pdf_bytes.startswith(b"%PDF"):
        raise InvalidPDFException(detail="Uploaded file does not appear to be a valid PDF.")

    domain_repo = DomainPromptRepository(db)
    domain = await domain_repo.create(
        user_id=current_user.user_id,
        name=name.strip(),
        description=description.strip() if description else None,
        status=DomainPromptStatus.pending,
        credits_charged=10,
    )

    import anyio

    minio_cfg = get_minio_settings()
    bucket = minio_cfg.MINIO_BUCKET_NAME
    pdf_key = object_key(str(current_user.user_id), str(domain.id), "source.pdf")
    await anyio.to_thread.run_sync(
        lambda: upload_bytes(bucket, pdf_key, pdf_bytes, content_type="application/pdf")
    )

    await domain_repo.save_dataset(
        domain_id=domain.id,
        user_id=current_user.user_id,
        bucket=bucket,
        pdf_key=pdf_key,
    )
    usage_repo = UsageEventRepository(db)
    await usage_repo.log(user_id=current_user.user_id, action="domain_pdo", credits_spent=10)
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.user_id))

    prepare_domain_dataset.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain.id),
            "user_id": str(current_user.user_id),
        }
    )
    log.info("domain_dataset_job_queued", job_id=job_id, domain_id=str(domain.id))

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain.id))


@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[DomainJobPollResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Poll domain job",
    description="Poll for the status of a dataset-building or optimization job.",
    responses=error_responses(401, 404, 429, 500),
)
async def poll_domain_job(
    job_id: str,
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DomainJobPollResponse]:
    """Poll for domain optimization job status."""
    owner = await get_dp_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise DomainJobNotFoundException()

    job_status = await get_dp_job_status(job_id)
    if job_status is None:
        raise DomainJobNotFoundException()

    result = None
    error = None

    if job_status == "completed":
        raw = await get_dp_job_result(job_id)
        if raw:
            result = raw
    elif job_status == "failed":
        raw = await get_dp_job_result(job_id)
        if raw:
            error = raw.get("error", "Unknown error")

    stage = await get_dp_job_stage(job_id)

    return SuccessResponse(
        data=DomainJobPollResponse(
            job_id=job_id,
            status=job_status,
            stage=stage,
            result=result,
            error=error,
        )
    )


@router.get(
    "/{domain_id}",
    response_model=SuccessResponse[DomainPromptResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Get domain project",
    description="Return metadata and dataset info for a single domain project.",
    responses=error_responses(401, 404, 429, 500),
)
async def get_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DomainPromptResponse]:
    """Get a specific domain prompt with its optimized result."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()
    return SuccessResponse(data=_to_response(domain))


@router.get(
    "/{domain_id}/dataset",
    response_model=SuccessResponse[DatasetRowsResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Get dataset",
    description="Return the Q&A rows in this domain's knowledge base.",
    responses=error_responses(401, 404, 429, 500),
)
async def get_dataset_rows(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DatasetRowsResponse]:
    """Return the Q&A rows stored for this domain's dataset."""
    import json

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None or domain.dataset.dataset_key is None:
        return SuccessResponse(data=DatasetRowsResponse(rows=[], row_count=0))

    minio_cfg = get_minio_settings()
    try:
        raw = download_text(minio_cfg.MINIO_BUCKET_NAME, domain.dataset.dataset_key)
    except Exception:  # noqa: BLE001
        return SuccessResponse(data=DatasetRowsResponse(rows=[], row_count=0))

    rows: list[QAPair] = []
    for line in raw.strip().splitlines():
        try:
            obj = json.loads(line)
            if isinstance(obj, dict) and "question" in obj and "answer" in obj:
                rows.append(QAPair(question=str(obj["question"]), answer=str(obj["answer"])))
        except Exception:  # noqa: BLE001, S112
            continue

    return SuccessResponse(data=DatasetRowsResponse(rows=rows, row_count=len(rows)))


@router.put(
    "/{domain_id}/dataset",
    response_model=SuccessResponse[DatasetRowsResponse],
    dependencies=[Depends(_write_limiter)],
    summary="Update dataset",
    description="Replace the Q&A rows in this domain's knowledge base.",
    responses=error_responses(401, 404, 422, 429, 500),
)
async def update_dataset_rows(
    domain_id: uuid.UUID,
    body: UpdateDatasetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DatasetRowsResponse]:
    """Replace the dataset with the supplied rows."""
    import json

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None:
        raise DomainNotFoundException()

    minio_cfg = get_minio_settings()
    jsonl = "\n".join(
        json.dumps({"question": r.question, "answer": r.answer}, ensure_ascii=False)
        for r in body.rows
    )
    dataset_key = domain.dataset.dataset_key or object_key(
        str(current_user.user_id), str(domain_id), "dataset.jsonl"
    )
    upload_text(minio_cfg.MINIO_BUCKET_NAME, dataset_key, jsonl)
    await repo.update_dataset(domain.dataset, dataset_key=dataset_key, row_count=len(body.rows))
    await db.commit()

    return SuccessResponse(data=DatasetRowsResponse(rows=list(body.rows), row_count=len(body.rows)))


@router.post(
    "/{domain_id}/dataset/augment",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
    summary="Augment dataset",
    description="Generate additional Q&A pairs for the domain's knowledge base using LLM.",
    responses=error_responses(401, 404, 429, 500),
)
async def augment_dataset(
    domain_id: uuid.UUID,
    body: AugmentDatasetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CreateDomainJobResponse]:
    """Generate and append N additional Q&A rows using LLM. Cost: free."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None or domain.dataset.dataset_key is None:
        raise DomainNotFoundException()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.user_id))

    augment_domain_dataset.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain_id),
            "user_id": str(current_user.user_id),
            "count": body.count,
        }
    )
    log.info("domain_augment_job_queued", job_id=job_id, domain_id=str(domain_id), count=body.count)

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain_id))


@router.get(
    "/{domain_id}/tournament-state",
    response_model=SuccessResponse[TournamentStateResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Get tournament state",
    description="Return the live PDO tournament state for a running optimization.",
    responses=error_responses(401, 404, 429, 500),
)
async def get_tournament_state(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[TournamentStateResponse]:
    """Return live tournament state written by the optimizer during a running PDO job."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    state = await get_dp_tournament_state(str(domain_id))
    if state is None:
        raise HTTPException(status_code=404, detail="No tournament state available yet.")

    return SuccessResponse(data=TournamentStateResponse(**state))


@router.post(
    "/{domain_id}/optimize",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
    summary="Start optimization",
    description="Start a PDO or GEPA optimization run against this domain's knowledge base. Costs tokens based on effort tier.",  # noqa: E501
    responses=error_responses(401, 402, 404, 409, 429, 500),
)
async def reoptimize_domain(
    domain_id: uuid.UUID,
    body: OptimizeDomainRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Optimize a prompt against this domain's knowledge base. Cost: 10 credits.

    The domain's Q&A dataset (built from its PDF) is used to score and improve
    the supplied prompt. You can call this endpoint repeatedly with different
    prompts — the domain dataset is reused each time.
    """
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    if domain.status in (DomainPromptStatus.preparing_dataset, DomainPromptStatus.optimizing):
        raise DomainAlreadyRunningException()

    if domain.dataset is None or domain.dataset.dataset_key is None:
        raise DomainNotReadyException()

    user_repo = UserRepository(db)
    if not await user_repo.has_min_tokens(current_user.user_id):
        raise DomainInsufficientCreditsException()

    await repo.set_status(domain, DomainPromptStatus.optimizing, last_prompt=body.prompt.strip())
    usage_repo = UsageEventRepository(db)
    await usage_repo.log(user_id=current_user.user_id, action="domain_pdo", credits_spent=0)
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.user_id))

    run_domain_optimization.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain_id),
            "user_id": str(current_user.user_id),
            "prompt_to_optimize": body.prompt.strip(),
        }
    )
    log.info("domain_optimize_job_queued", job_id=job_id, domain_id=str(domain_id))

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain_id))


@router.get(
    "/{domain_id}/runs",
    response_model=SuccessResponse[RunListResponse],
    dependencies=[Depends(_read_limiter)],
    summary="List domain runs",
    description="Return all past optimization runs for a specific domain project.",
    responses=error_responses(401, 404, 429, 500),
)
async def list_domain_runs(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[RunListResponse]:
    """Return optimization run history for a domain (newest first, max 50)."""
    domain_repo = DomainPromptRepository(db)
    domain = await domain_repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    run_repo = DomainOptimizationRunRepository(db)
    runs = await run_repo.get_runs_by_domain(domain_id)
    return SuccessResponse(
        data=RunListResponse(runs=[OptimizationRunResponse.model_validate(r) for r in runs])
    )


@router.post(
    "/{domain_id}/stop",
    response_model=SuccessResponse[DomainPromptResponse],
    dependencies=[Depends(_write_limiter)],
    summary="Force-stop optimization",
    description="Force-stop a stuck or running optimization job.",
    responses=error_responses(401, 404, 429, 500),
)
async def stop_domain_tournament(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DomainPromptResponse]:
    """
    Force-stop a stuck tournament.

    If the Celery worker crashed mid-run, the domain stays in 'optimizing' or
    'preparing_dataset' forever. This endpoint resets it to 'completed' (when a
    dataset exists) or 'failed' so the user can try again.
    """
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    recoverable_statuses = (
        DomainPromptStatus.optimizing,
        DomainPromptStatus.preparing_dataset,
        DomainPromptStatus.cancelled,
    )
    if domain.status not in recoverable_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Domain is not in a recoverable state — nothing to stop.",
        )

    # Reset to completed if dataset is ready, otherwise to failed
    has_dataset = domain.dataset is not None and domain.dataset.dataset_key is not None
    new_status = DomainPromptStatus.completed if has_dataset else DomainPromptStatus.failed
    await repo.set_status(domain, new_status)
    await db.commit()
    await db.refresh(domain)
    log.warning(
        "domain_tournament_force_stopped",
        domain_id=str(domain_id),
        new_status=new_status.value,
    )

    return SuccessResponse(data=DomainPromptResponse.model_validate(domain))


async def _do_cancel(
    *,
    job_id: str,
    domain: DomainPrompt,
    repo: DomainPromptRepository,
    db: AsyncSession,
) -> None:
    """Shared cancel logic: revoke Celery task, signal worker, update DB."""
    from promptly.workers.celery_app import celery_app as _celery_app

    celery_task_id = await get_dp_celery_task_id(job_id)
    if celery_task_id:
        from celery.result import AsyncResult

        ar = AsyncResult(celery_task_id, app=_celery_app)
        await asyncio.to_thread(lambda: ar.revoke(terminate=True, signal="SIGTERM"))

    await set_dp_job_cancel(job_id)
    await set_dp_job_status(job_id, "cancelled")
    await set_dp_job_result(job_id, {"error": "Cancelled by user."})
    await clear_dp_domain_active_job(str(domain.id))
    await clear_dp_tournament_state(str(domain.id))

    # Cancelling a *run* must not kill the *domain*: if the Q&A dataset already exists the
    # domain stays usable (-> completed / "Ready") so the user can run PDO again. Only a
    # cancel during dataset preparation (no dataset yet) leaves the domain cancelled.
    has_dataset = domain.dataset is not None and domain.dataset.dataset_key is not None
    if has_dataset:
        await repo.set_status(domain, DomainPromptStatus.completed, error_message=None)
    else:
        await repo.set_status(
            domain, DomainPromptStatus.cancelled, error_message="Cancelled by user."
        )

    await db.commit()


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=SuccessResponse[CancelDomainJobResponse],
    dependencies=[Depends(_write_limiter)],
    summary="Cancel job",
    description="Cancel a queued or running domain job and refund the reserved tokens.",
    responses=error_responses(401, 404, 409, 429, 500),
)
async def cancel_domain_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CancelDomainJobResponse]:
    """
    Cancel a queued or running domain job by its Redis job_id.

    Available immediately after job creation; use POST /{domain_id}/cancel when the
    job_id is no longer in memory (e.g., after a page reload).
    Refunds 10 credits for prepare_dataset and optimize stages.
    """
    owner = await get_dp_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise DomainJobNotFoundException()

    job_status = await get_dp_job_status(job_id)
    _terminal = ("completed", "failed", "cancelled")
    if job_status in _terminal:
        raise DomainJobNotCancellableException()

    domain_id_str = await get_dp_job_domain_id(job_id)
    if domain_id_str is None:
        raise DomainJobNotFoundException()

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(uuid.UUID(domain_id_str), current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    await _do_cancel(job_id=job_id, domain=domain, repo=repo, db=db)
    log.info("domain_job_cancelled", job_id=job_id, domain_id=domain_id_str)

    return SuccessResponse(
        data=CancelDomainJobResponse(job_id=job_id, domain_id=domain_id_str, cancelled=True)
    )


@router.post(
    "/{domain_id}/cancel",
    response_model=SuccessResponse[CancelDomainJobResponse],
    dependencies=[Depends(_write_limiter)],
    summary="Cancel active domain job",
    description="Cancel the currently active job for a domain project.",
    responses=error_responses(401, 404, 429, 500),
)
async def cancel_domain_by_id(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CancelDomainJobResponse]:
    """
    Cancel a running domain job by domain_id.

    Use this after a page reload when the Redis job_id is no longer known.
    Looks up the active job_id from Redis. If Redis has expired (worker crashed long
    ago), falls back to a force-stop (DB-only reset) so the domain becomes usable again.
    Refunds 10 credits for prepare_dataset and optimize stages.
    """
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()

    cancellable_statuses = (
        DomainPromptStatus.pending,
        DomainPromptStatus.preparing_dataset,
        DomainPromptStatus.optimizing,
    )
    if domain.status not in cancellable_statuses:
        raise DomainJobNotCancellableException()

    active_job_id = await get_dp_domain_active_job(str(domain_id))

    if active_job_id:
        await _do_cancel(
            job_id=active_job_id,
            domain=domain,
            repo=repo,
            db=db,
        )
        log.info("domain_cancelled_by_domain_id", domain_id=str(domain_id), job_id=active_job_id)
        return SuccessResponse(
            data=CancelDomainJobResponse(
                job_id=active_job_id, domain_id=str(domain_id), cancelled=True
            )
        )

    # Redis expired — worker either crashed or finished long ago; force-stop DB state.
    has_dataset = domain.dataset is not None and domain.dataset.dataset_key is not None
    fallback_status = DomainPromptStatus.completed if has_dataset else DomainPromptStatus.cancelled
    await repo.set_status(domain, fallback_status, error_message="Force-stopped by user.")
    await db.commit()
    log.warning(
        "domain_force_stopped_no_redis", domain_id=str(domain_id), fallback=fallback_status.value
    )
    return SuccessResponse(
        data=CancelDomainJobResponse(job_id="", domain_id=str(domain_id), cancelled=True)
    )


@router.delete(
    "/{domain_id}",
    response_model=SuccessResponse[DeleteDomainResponse],
    dependencies=[Depends(_write_limiter)],
    summary="Delete domain project",
    description="Permanently delete a domain project, its dataset, and all optimization runs.",
    responses=error_responses(401, 404, 429, 500),
)
async def delete_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DeleteDomainResponse]:
    """Delete a domain and its associated dataset records."""
    import anyio

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.user_id)
    if domain is None:
        raise DomainNotFoundException()
    await repo.delete(domain)
    await db.commit()

    minio_cfg = get_minio_settings()
    prefix = f"users/{current_user.user_id}/domains/{domain_id}/"
    await anyio.to_thread.run_sync(
        lambda: delete_objects_with_prefix(minio_cfg.MINIO_BUCKET_NAME, prefix)
    )
    log.info("domain_deleted", domain_id=str(domain_id))

    return SuccessResponse(data=DeleteDomainResponse(domain_id=domain_id))
