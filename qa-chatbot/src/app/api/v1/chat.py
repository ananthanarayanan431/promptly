import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.cache import get_job_result, get_job_status, set_job_status
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.prompt_version_repo import PromptVersionRepository
from app.schemas.chat import ChatJobAcceptedResponse, ChatRequest, ChatResponse, JobPollResponse
from app.workers.tasks import process_chat_async

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post(
    "/",
    response_model=SuccessResponse[ChatJobAcceptedResponse],
    status_code=202,
)
async def create_chat(
    request: ChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ChatJobAcceptedResponse]:
    """
    Submit a prompt for optimization.

    **Two ways to supply the prompt:**
    - `prompt` — paste raw text directly
    - `prompt_id` — reference an existing versioned prompt; the latest version is
      used as input and the optimized result is saved automatically as the next version

    **Optional versioning for raw prompts:**
    - Add `name` alongside `prompt` to track the result as a named version family.
      The original becomes v1 and the optimized result becomes v2 (or appends to an
      existing family with the same name).

    **Optional feedback:**
    - Add `feedback` to steer how the council optimizes
      (e.g. "keep it under 50 words", "add a JSON output format").

    Returns immediately with a `job_id` (HTTP 202 Accepted). Poll
    `GET /chat/jobs/{job_id}` until `status` is `completed` or `failed`.

    Cost: 10 credits, deducted on submission.
    """
    if current_user.credits < 10:
        raise HTTPException(
            status_code=402,
            detail="Insufficient credits. 10 credits required per run.",
        )

    # Resolve prompt content and versioning context
    raw_prompt: str
    resolved_prompt_id: str | None = None
    resolved_name: str | None = request.name

    if request.prompt_id:
        version_repo = PromptVersionRepository(db)
        latest = await version_repo.get_latest_by_prompt_id(request.prompt_id, current_user.id)
        if latest is None:
            raise HTTPException(status_code=404, detail="Versioned prompt not found.")
        raw_prompt = latest.content
        resolved_prompt_id = str(request.prompt_id)
        resolved_name = resolved_name or latest.name
    else:
        raw_prompt = request.prompt  # type: ignore[assignment]  # validated: one must exist

    current_user.credits -= 10
    await db.flush()

    job_id = str(uuid.uuid4())
    session_id = str(request.session_id) if request.session_id else str(uuid.uuid4())

    await set_job_status(job_id, "queued")

    process_chat_async.apply_async(
        kwargs={
            "job_id": job_id,
            "user_id": str(current_user.id),
            "raw_prompt": raw_prompt,
            "session_id": session_id,
            "feedback": request.feedback,
            "prompt_id": resolved_prompt_id,
            "name": resolved_name,
        },
    )

    return SuccessResponse(
        data=ChatJobAcceptedResponse(
            job_id=job_id,
            session_id=session_id,
            prompt_id=resolved_prompt_id,
        )
    )


@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[JobPollResponse],
)
async def poll_chat_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[JobPollResponse]:
    """
    Poll for the result of a queued optimization job.

    Keep calling until `status` is `completed` or `failed`.
    Recommended polling interval: 2–3 seconds.

    When versioning was involved, the completed `result` includes
    `prompt_id` and `version` so you can query the full history via
    `GET /prompts/versions/{prompt_id}`.
    """
    status = await get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    result: ChatResponse | None = None
    error: str | None = None

    if status == "completed":
        raw = await get_job_result(job_id)
        if raw:
            result = ChatResponse(**raw)

    elif status == "failed":
        raw = await get_job_result(job_id)
        if raw:
            error = raw.get("error", "Unknown error")

    return SuccessResponse(
        data=JobPollResponse(job_id=job_id, status=status, result=result, error=error)
    )
