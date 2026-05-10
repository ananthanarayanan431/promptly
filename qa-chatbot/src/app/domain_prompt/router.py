from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.config.env import get_minio_settings
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.domain_prompt.cache import (
    get_dp_job_owner,
    get_dp_job_result,
    get_dp_job_status,
    set_dp_job_owner,
    set_dp_job_status,
)
from app.domain_prompt.exceptions import (
    DomainAlreadyRunningException,
    DomainInsufficientCreditsException,
    DomainJobNotFoundException,
    DomainNotFoundException,
    DomainNotReadyException,
    InvalidPDFException,
)
from app.domain_prompt.models import DomainPrompt, DomainPromptStatus
from app.domain_prompt.repository import DomainOptimizationRunRepository, DomainPromptRepository
from app.domain_prompt.schemas import (
    AugmentDatasetRequest,
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
from app.domain_prompt.storage import object_key, upload_bytes
from app.domain_prompt.tasks import augment_domain_dataset, prepare_domain_dataset
from app.models.user import User
from app.repositories.user_repo import UserRepository

router = APIRouter(prefix="/domain-prompts", tags=["domain-prompts"])

_write_limiter = RateLimiter(requests=10, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)


def _to_response(domain: DomainPrompt) -> DomainPromptResponse:
    return DomainPromptResponse.model_validate(domain)


@router.get(
    "/",
    response_model=SuccessResponse[DomainListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_domains(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainListResponse]:
    """List all domain prompts for the current user."""
    repo = DomainPromptRepository(db)
    domains = await repo.get_by_user(current_user.id)
    return SuccessResponse(data=DomainListResponse(domains=[_to_response(d) for d in domains]))


@router.post(
    "/",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def create_domain(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    name: Annotated[str, Form(min_length=1, max_length=120)],
    file: Annotated[UploadFile, File()],
    description: Annotated[str | None, Form(max_length=500)] = None,
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Create a domain knowledge base by uploading a PDF.

    The PDF is stored in MinIO and a Q&A dataset is generated from it.
    No prompt is needed here — submit prompts via POST /{domain_id}/optimize.

    Cost: 10 credits, deducted immediately.
    Returns HTTP 202 with a job_id to poll for progress.
    """
    if current_user.credits < 10:
        raise DomainInsufficientCreditsException()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise InvalidPDFException()

    # Enforce 100 MB upload limit
    _max_pdf_bytes = 100 * 1024 * 1024
    pdf_bytes = await file.read()
    if len(pdf_bytes) > _max_pdf_bytes:
        raise InvalidPDFException(detail="PDF file exceeds the 100 MB size limit.")
    if not pdf_bytes.startswith(b"%PDF"):
        raise InvalidPDFException(detail="Uploaded file does not appear to be a valid PDF.")

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, 10)
    if not deducted:
        raise DomainInsufficientCreditsException()

    domain_repo = DomainPromptRepository(db)
    domain = await domain_repo.create(
        user_id=current_user.id,
        name=name.strip(),
        description=description.strip() if description else None,
        status=DomainPromptStatus.pending,
        credits_charged=10,
    )

    import anyio

    minio_cfg = get_minio_settings()
    bucket = minio_cfg.MINIO_BUCKET_NAME
    pdf_key = object_key(str(current_user.id), str(domain.id), "source.pdf")
    await anyio.to_thread.run_sync(
        lambda: upload_bytes(bucket, pdf_key, pdf_bytes, content_type="application/pdf")
    )

    await domain_repo.save_dataset(
        domain_id=domain.id,
        user_id=current_user.id,
        bucket=bucket,
        pdf_key=pdf_key,
    )
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.id))

    prepare_domain_dataset.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain.id),
            "user_id": str(current_user.id),
        }
    )

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain.id))


@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[DomainJobPollResponse],
    dependencies=[Depends(_read_limiter)],
)
async def poll_domain_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainJobPollResponse]:
    """Poll for domain optimization job status."""
    owner = await get_dp_job_owner(job_id)
    if owner is None or owner != str(current_user.id):
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

    return SuccessResponse(
        data=DomainJobPollResponse(
            job_id=job_id,
            status=job_status,
            result=result,
            error=error,
        )
    )


@router.get(
    "/{domain_id}",
    response_model=SuccessResponse[DomainPromptResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainPromptResponse]:
    """Get a specific domain prompt with its optimized result."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    return SuccessResponse(data=_to_response(domain))


@router.get(
    "/{domain_id}/dataset",
    response_model=SuccessResponse[DatasetRowsResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_dataset_rows(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DatasetRowsResponse]:
    """Return the Q&A rows stored for this domain's dataset."""
    import json

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None or domain.dataset.dataset_key is None:
        return SuccessResponse(data=DatasetRowsResponse(rows=[], row_count=0))

    minio_cfg = get_minio_settings()
    from app.domain_prompt.storage import download_text

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
)
async def update_dataset_rows(
    domain_id: uuid.UUID,
    body: UpdateDatasetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DatasetRowsResponse]:
    """Replace the dataset with the supplied rows."""
    import json

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None:
        raise DomainNotFoundException()

    minio_cfg = get_minio_settings()
    from app.domain_prompt.storage import object_key as _okey
    from app.domain_prompt.storage import upload_text

    jsonl = "\n".join(
        json.dumps({"question": r.question, "answer": r.answer}, ensure_ascii=False)
        for r in body.rows
    )
    dataset_key = domain.dataset.dataset_key or _okey(
        str(current_user.id), str(domain_id), "dataset.jsonl"
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
)
async def augment_dataset(
    domain_id: uuid.UUID,
    body: AugmentDatasetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CreateDomainJobResponse]:
    """Generate and append N additional Q&A rows using LLM. Cost: free."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    if domain.dataset is None or domain.dataset.dataset_key is None:
        raise DomainNotFoundException()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.id))

    augment_domain_dataset.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain_id),
            "user_id": str(current_user.id),
            "count": body.count,
        }
    )

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain_id))


@router.get(
    "/{domain_id}/tournament-state",
    response_model=SuccessResponse[TournamentStateResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_tournament_state(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[TournamentStateResponse]:
    """Return live tournament state written by the optimizer during a running PDO job."""
    from app.domain_prompt.cache import get_dp_tournament_state
    from app.domain_prompt.exceptions import DomainNotFoundException

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()

    state = await get_dp_tournament_state(str(domain_id))
    if state is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="No tournament state available yet.")

    return SuccessResponse(data=TournamentStateResponse(**state))


@router.post(
    "/{domain_id}/optimize",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def reoptimize_domain(
    domain_id: uuid.UUID,
    body: OptimizeDomainRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Optimize a prompt against this domain's knowledge base. Cost: 10 credits.

    The domain's Q&A dataset (built from its PDF) is used to score and improve
    the supplied prompt. You can call this endpoint repeatedly with different
    prompts — the domain dataset is reused each time.
    """
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()

    if domain.status in (DomainPromptStatus.preparing_dataset, DomainPromptStatus.optimizing):
        raise DomainAlreadyRunningException()

    if domain.dataset is None or domain.dataset.dataset_key is None:
        raise DomainNotReadyException()

    if current_user.credits < 10:
        raise DomainInsufficientCreditsException()

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, 10)
    if not deducted:
        raise DomainInsufficientCreditsException()

    await repo.set_status(domain, DomainPromptStatus.optimizing, last_prompt=body.prompt.strip())
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.id))

    from app.domain_prompt.tasks import run_domain_optimization

    run_domain_optimization.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain_id),
            "user_id": str(current_user.id),
            "prompt_to_optimize": body.prompt.strip(),
        }
    )

    return SuccessResponse(data=CreateDomainJobResponse(job_id=job_id, domain_id=domain_id))


@router.get(
    "/{domain_id}/runs",
    response_model=SuccessResponse[RunListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_domain_runs(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[RunListResponse]:
    """Return optimization run history for a domain (newest first, max 50)."""
    domain_repo = DomainPromptRepository(db)
    domain = await domain_repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()

    run_repo = DomainOptimizationRunRepository(db)
    runs = await run_repo.get_runs_by_domain(domain_id)
    return SuccessResponse(
        data=RunListResponse(runs=[OptimizationRunResponse.model_validate(r) for r in runs])
    )


@router.delete(
    "/{domain_id}",
    response_model=SuccessResponse[DeleteDomainResponse],
    dependencies=[Depends(_write_limiter)],
)
async def delete_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DeleteDomainResponse]:
    """Delete a domain and its associated dataset records."""
    import anyio

    from app.domain_prompt.storage import delete_objects_with_prefix

    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    await repo.delete(domain)
    await db.commit()

    minio_cfg = get_minio_settings()
    prefix = f"users/{current_user.id}/domains/{domain_id}/"
    await anyio.to_thread.run_sync(
        lambda: delete_objects_with_prefix(minio_cfg.MINIO_BUCKET_NAME, prefix)
    )

    return SuccessResponse(data=DeleteDomainResponse(domain_id=domain_id))
