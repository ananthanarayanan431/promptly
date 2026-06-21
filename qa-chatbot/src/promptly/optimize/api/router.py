import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.api.types.response import SuccessResponse, error_responses
from promptly.api.v1.exceptions.categories import InvalidCategoryException
from promptly.core.cache import (
    get_job_owner,
    get_job_progress_from,
    get_job_result,
    get_job_status,
    set_job_owner,
    set_job_status,
)
from promptly.core.rate_limit import RateLimiter
from promptly.core.user_context import UserContext
from promptly.dependencies import get_current_user, get_db
from promptly.llm.naming import build_naming_llm
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.optimize.api.exceptions import (
    ChatInsufficientCreditsException,
    InvalidSessionIDException,
    JobNotFoundException,
    LLMTimeoutException,
    SessionNotFoundException,
    VersionedPromptNotFoundException,
)
from promptly.optimize.api.schemas import (
    ChatJobAcceptedResponse,
    ChatRequest,
    ChatResponse,
    DeleteSessionResponse,
    JobPollResponse,
    MessageOut,
    RecentSessionsResponse,
    RecentSessionWithPrompt,
    RenameSessionRequest,
    SaveVersionRequest,
    SaveVersionResponse,
    SessionDetailResponse,
    SessionsGroupedResponse,
    SessionSummary,
    SuggestNameRequest,
    SuggestNameResponse,
)
from promptly.optimize.workers.tasks import process_chat_async
from promptly.repositories.message_repo import MessageRepository
from promptly.repositories.prompt_version_repo import PromptVersionRepository
from promptly.repositories.session_repo import SessionRepository
from promptly.repositories.user_repo import UserRepository
from promptly.services.category_service import CategoryService
from promptly.utils.log import get_logger

log = get_logger(__name__)

_chat_limiter = RateLimiter(requests=10, window_seconds=60)
_llm_limiter = RateLimiter(requests=20, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)

router = APIRouter(prefix="/chat", tags=["chat"])


# -------------------------
# CREATE CHAT
# -------------------------
@router.post(
    "/",
    response_model=SuccessResponse[ChatJobAcceptedResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_chat_limiter)],
    summary="Submit optimization job",
    description="Queue a prompt-optimization job through the 4-model council pipeline (council vote → critic → synthesize). Returns HTTP 202 with a `job_id`; poll `GET /chat/jobs/{job_id}` for the result.",  # noqa: E501
    responses=error_responses(400, 401, 402, 422, 429, 500),
)
async def create_chat(
    request: ChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
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
        log.warning(
            "insufficient_credits",
            user_id=str(current_user.user_id),
            available=current_user.credits,
            required=10,
        )
        raise ChatInsufficientCreditsException()

    # Resolve category — defaults to "general" if omitted; 422 if slug unknown.
    category_service = CategoryService(db)
    requested_slug = request.category_slug or "general"
    category = await category_service.resolve(slug=requested_slug, user_id=current_user.user_id)
    if category is None:
        raise InvalidCategoryException(detail=f"Unknown category slug: {requested_slug}")
    resolved_category_slug = category.slug

    # Resolve prompt content and versioning context
    raw_prompt: str
    resolved_prompt_id: str | None = None
    resolved_name: str | None = request.name

    if request.prompt_id:
        version_repo = PromptVersionRepository(db)
        latest = await version_repo.get_latest_by_prompt_id(request.prompt_id, current_user.user_id)
        if latest is None:
            raise VersionedPromptNotFoundException()
        raw_prompt = latest.content
        resolved_prompt_id = str(request.prompt_id)
        resolved_name = resolved_name or latest.name
    else:
        raw_prompt = request.prompt  # type: ignore[assignment]  # validated: one must exist

    job_id = str(uuid.uuid4())
    session_id = str(request.session_id) if request.session_id else str(uuid.uuid4())

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.user_id, 10)
    if not deducted:
        log.warning("credit_deduction_failed", user_id=str(current_user.user_id), required=10)
        raise ChatInsufficientCreditsException()
    log.info("credits_deducted", user_id=str(current_user.user_id), amount=10)

    # Ensure session exists BEFORE worker
    session_repo = SessionRepository(db)
    await session_repo.get_or_create(
        session_id=session_id,
        user_id=current_user.user_id,
        graph_thread_id=session_id,
    )

    await set_job_status(job_id, "queued")
    await set_job_owner(job_id, str(current_user.user_id))

    try:
        process_chat_async.apply_async(
            kwargs={
                "job_id": job_id,
                "user_id": str(current_user.user_id),
                "raw_prompt": raw_prompt,
                "session_id": session_id,
                "feedback": request.feedback,
                "prompt_id": resolved_prompt_id,
                "name": resolved_name,
                "category_slug": resolved_category_slug,
                "force_optimize": request.force_optimize,
            },
        )
    except Exception as exc:
        log.error(  # noqa: E501
            "job_enqueue_failed", job_id=job_id, user_id=str(current_user.user_id), error=str(exc)
        )
        await user_repo.refund_credits(current_user.user_id, 10)
        log.info(
            "credits_refunded",
            user_id=str(current_user.user_id),
            amount=10,
            reason="enqueue_failed",  # noqa: E501
        )
        raise LLMTimeoutException() from exc

    log.info(
        "chat_job_queued",
        job_id=job_id,
        session_id=session_id,
        category=resolved_category_slug,
        user_id=str(current_user.user_id),
    )
    return SuccessResponse(
        data=ChatJobAcceptedResponse(
            job_id=job_id,
            session_id=session_id,
            prompt_id=resolved_prompt_id,
        )
    )


# -------------------------
# POLL CHAT JOB
# -------------------------
@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[JobPollResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Poll job status",
    description="Return the current status and result of a council optimization job. Poll at ~2 s intervals until `status` is `completed` or `failed`.",  # noqa: E501
    responses=error_responses(401, 404, 429, 500),
)
async def poll_chat_job(
    job_id: str,
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[JobPollResponse]:
    """
    Poll for the result of a queued optimization job.

    Keep calling until `status` is `completed` or `failed`.
    Recommended polling interval: 2–3 seconds.

    When versioning was involved, the completed `result` includes
    `prompt_id` and `version` so you can query the full history via
    `GET /prompts/versions/{prompt_id}`.
    """

    # ✅ SECURITY FIX
    owner = await get_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise JobNotFoundException()

    status = await get_job_status(job_id)
    if status is None:
        raise JobNotFoundException()

    # Optional: timeout handling (simple version)
    if status == "queued":
        # You can store created_at in cache for better logic
        pass

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


@router.get(
    "/jobs/{job_id}/stream",
    response_class=StreamingResponse,
    dependencies=[Depends(_read_limiter)],
    summary="Stream job progress",
    description="SSE stream of job progress events. Each event carries a `step` field; the final event embeds the full result.",  # noqa: E501
    responses=error_responses(401, 404, 500),
)
async def stream_job_progress(
    job_id: str,
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> StreamingResponse:
    """
    SSE stream of real-time pipeline progress events.

    Streams JSON events as ``data: {...}\\n\\n`` until the job completes or fails.
    The terminal ``completed`` event embeds the full result so no second fetch is needed.
    Poll interval on the server side: 250 ms.
    """
    owner = await get_job_owner(job_id)
    if owner is None or owner != str(current_user.user_id):
        raise JobNotFoundException()

    async def generate() -> AsyncGenerator[str, None]:
        # 300 s ceiling — enough for 3 quality-gate refinement passes
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 300
        last_idx = 0
        while loop.time() < deadline:
            events = await get_job_progress_from(job_id, last_idx)
            for ev in events:
                yield f"data: {json.dumps(ev)}\n\n"
                last_idx += 1

            status = await get_job_status(job_id)

            if status == "completed":
                # Drain any events written between last poll and the status check
                events = await get_job_progress_from(job_id, last_idx)
                for ev in events:
                    yield f"data: {json.dumps(ev)}\n\n"
                result_raw = await get_job_result(job_id)
                if result_raw is None:
                    ev_str = json.dumps({"step": "failed", "error": "Result unavailable"})
                    yield f"data: {ev_str}\n\n"
                    return
                yield f"data: {json.dumps({'step': 'completed', 'result': result_raw})}\n\n"
                return

            if status == "failed":
                result_raw = await get_job_result(job_id)
                error = (result_raw or {}).get("error", "Unknown error")
                yield f"data: {json.dumps({'step': 'failed', 'error': error})}\n\n"
                return

            if status is None:
                yield f"data: {json.dumps({'step': 'failed', 'error': 'Job not found'})}\n\n"
                return

            await asyncio.sleep(0.25)

        yield f"data: {json.dumps({'step': 'failed', 'error': 'Stream timeout'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/suggest-name",
    summary="Suggest version name",
    description="Generate a short ALL-CAPS version name (2–4 words) for a prompt using LLM. Used by the frontend versioning widget.",  # noqa: E501
    response_model=SuccessResponse[SuggestNameResponse],
    dependencies=[Depends(_llm_limiter)],
    responses=error_responses(401, 429, 500, 504),
)
async def suggest_prompt_name(
    request: SuggestNameRequest,
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SuggestNameResponse]:
    """
    Generate a short ALL-CAPS version name (2–4 words) for a given prompt text.
    Used by the frontend versioning toggle in the chat input.
    """

    model = build_naming_llm()
    try:
        response = await asyncio.wait_for(
            model.ainvoke(
                [
                    {
                        "role": "system",
                        "content": (
                            "Generate a 2–4 word ALL-CAPS name that describes the purpose of this"
                            " prompt (e.g. EMAIL SUBJECT OPTIMIZER, CODE REVIEW HELPER, BLOG INTRO"
                            " WRITER). Return ONLY the name — no punctuation, no explanation."
                        ),
                    },
                    {"role": "user", "content": request.prompt[:500]},
                ]
            ),
            timeout=10.0,
        )
    except TimeoutError as exc:
        raise LLMTimeoutException() from exc
    name = str(response.content).strip().upper()[:80]
    return SuccessResponse(data=SuggestNameResponse(name=name))


@router.post(
    "/save-version",
    summary="Save prompt as version family",
    description="Save a prompt and its optimised output as v1 + v2 of a new version family. An ALL-CAPS name is auto-generated via LLM. Returns the `prompt_id` to use for subsequent runs.",  # noqa: E501
    response_model=SuccessResponse[SaveVersionResponse],
    dependencies=[Depends(_llm_limiter)],
    responses=error_responses(401, 422, 429, 500, 504),
)
async def save_version_from_response(
    request: SaveVersionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SaveVersionResponse]:
    """
    Save a prompt + its optimized response as v1 + v2 of a new version family.
    An ALL-CAPS name is generated automatically via LLM.
    Returns the prompt_id to pass in subsequent chat requests so each new
    optimized result is appended as v3, v4, …
    """

    model = build_naming_llm()
    try:
        llm_response = await asyncio.wait_for(
            model.ainvoke(
                [
                    {
                        "role": "system",
                        "content": (
                            "Generate a 2–4 word ALL-CAPS name that describes the purpose of this"
                            " prompt (e.g. EMAIL SUBJECT OPTIMIZER, CODE REVIEW HELPER, BLOG INTRO"
                            " WRITER). Return ONLY the name — no punctuation, no explanation."
                        ),
                    },
                    {"role": "user", "content": request.original_prompt[:500]},
                ]
            ),
            timeout=10.0,
        )
    except TimeoutError as exc:
        raise LLMTimeoutException() from exc
    name = str(llm_response.content).strip().upper()[:80] or "MY PROMPT"

    prompt_id = uuid.uuid4()
    version_repo = PromptVersionRepository(db)

    await version_repo.create_version(
        prompt_id=prompt_id,
        user_id=current_user.user_id,
        name=name,
        version=1,
        content=request.original_prompt,
    )
    await version_repo.create_version(
        prompt_id=prompt_id,
        user_id=current_user.user_id,
        name=name,
        version=2,
        content=request.optimized_prompt,
    )
    await db.commit()

    return SuccessResponse(data=SaveVersionResponse(prompt_id=str(prompt_id), name=name, version=2))


@router.get(
    "/sessions",
    response_model=SuccessResponse[SessionsGroupedResponse],
    dependencies=[Depends(_read_limiter)],
    summary="List chat sessions",
    description="Return grouped chat sessions (today / last 7 days / last 30 days / older) with per-session aggregated token counts and feedback.",  # noqa: E501
    responses=error_responses(401, 429, 500),
)
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SessionsGroupedResponse]:
    """
    Return this user's chat sessions grouped by recency: today / last 7 days /
    last 30 days / older.  Sessions without a title are included (they show as
    "Untitled" in the sidebar while the run is still in progress).
    """
    session_repo = SessionRepository(db)
    # Load messages eagerly so we can aggregate token_count, feedback, and prompts
    sessions = await session_repo.get_by_user_id(
        current_user.user_id, limit=100, with_messages=True
    )

    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    def _bucket(s: ChatSession) -> str:
        ct: datetime = s.created_at
        if ct.tzinfo is None:
            ct = ct.replace(tzinfo=UTC)
        if ct >= today_start:
            return "today"
        if ct >= week_ago:
            return "last_7_days"
        if ct >= month_ago:
            return "last_30_days"
        return "older"

    grouped: dict[str, list[SessionSummary]] = {
        "today": [],
        "last_7_days": [],
        "last_30_days": [],
        "older": [],
    }
    for s in sessions:
        # Aggregate from messages (token sum, feedback count, prompt/result text, reasoning)
        token_total = sum(
            (m.token_usage or {}).get("total_tokens", 0) for m in s.messages if m.token_usage
        )
        feedback_total = sum(1 for m in s.messages if m.feedback)
        asst_msgs = sorted(
            [m for m in s.messages if m.role == "assistant"], key=lambda m: m.created_at
        )
        prompt_input = asst_msgs[0].raw_prompt if asst_msgs else None
        optimized_prompt = asst_msgs[-1].response if asst_msgs else None
        last_tu = (asst_msgs[-1].token_usage or {}) if asst_msgs else {}
        reasoning = last_tu.get("_reasoning") or None

        grouped[_bucket(s)].append(
            SessionSummary(
                id=s.id,
                title=s.title,
                created_at=s.created_at,
                updated_at=s.updated_at,
                token_count=token_total or None,
                feedback_count=feedback_total,
                prompt_input=prompt_input,
                optimized_prompt=optimized_prompt,
                reasoning=reasoning,
            )
        )

    return SuccessResponse(data=SessionsGroupedResponse(**grouped))


@router.get(
    "/sessions/recent",
    summary="Recent sessions (dashboard widget)",
    description="Return the N most-recently-updated sessions with a prompt snippet. Used by the 'Continue where you left off' dashboard widget.",  # noqa: E501
    response_model=SuccessResponse[RecentSessionsResponse],
    dependencies=[Depends(_read_limiter)],
    responses=error_responses(401, 429, 500),
)
async def get_recent_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=10)] = 3,
) -> SuccessResponse[RecentSessionsResponse]:
    """
    Return the N most-recently-updated sessions with a snippet of the last
    user prompt. Used by the 'Continue where you left off' dashboard widget.
    """
    # Subquery: latest user message created_at per session
    latest_msg_sq = (
        select(
            Message.session_id.label("sid"),
            func.max(Message.created_at).label("last_msg_at"),
        )
        .where(Message.role == "user")
        .group_by(Message.session_id)
        .subquery()
    )

    # Join to get the actual raw_prompt of that message
    last_prompt_sq = (
        select(
            Message.session_id.label("sid"),
            Message.raw_prompt.label("raw_prompt"),
        )
        .join(
            latest_msg_sq,
            (Message.session_id == latest_msg_sq.c.sid)
            & (Message.created_at == latest_msg_sq.c.last_msg_at),
        )
        .where(Message.role == "user")
        .subquery()
    )

    stmt = (
        select(
            ChatSession.id,
            ChatSession.title,
            ChatSession.updated_at,
            last_prompt_sq.c.raw_prompt,
        )
        .outerjoin(last_prompt_sq, ChatSession.id == last_prompt_sq.c.sid)
        .where(ChatSession.user_id == current_user.user_id, ChatSession.title.isnot(None))
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    sessions = [
        RecentSessionWithPrompt(
            id=row.id,
            title=row.title,
            last_prompt=(row.raw_prompt or "")[:120] or None,
            updated_at=row.updated_at,
        )
        for row in rows
    ]
    return SuccessResponse(data=RecentSessionsResponse(sessions=sessions))


@router.get(
    "/sessions/{session_id}",
    response_model=SuccessResponse[SessionDetailResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Get session detail",
    description="Return all messages in a chat session.",
    responses=error_responses(401, 404, 429, 500),
)
async def get_session(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SessionDetailResponse]:
    """Return a specific session with all its messages (chronological order)."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError as exc:
        raise InvalidSessionIDException() from exc

    session_repo = SessionRepository(db)
    session = await session_repo.get_by_id(sid)
    if session is None or session.user_id != current_user.user_id:
        raise SessionNotFoundException()

    msg_repo = MessageRepository(db)
    messages = await msg_repo.get_by_session(sid, limit=50)

    return SuccessResponse(
        data=SessionDetailResponse(
            id=session.id,
            title=session.title,
            messages=[MessageOut.model_validate(m) for m in messages],
            created_at=session.created_at,
        )
    )


@router.patch(
    "/sessions/{session_id}",
    response_model=SuccessResponse[SessionSummary],
    dependencies=[Depends(_read_limiter)],
    summary="Update session",
    description="Rename a chat session.",
    responses=error_responses(401, 404, 422, 429, 500),
)
async def rename_session(
    session_id: str,
    request: RenameSessionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[SessionSummary]:
    """Rename a session's title."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError as exc:
        raise InvalidSessionIDException() from exc

    session_repo = SessionRepository(db)
    session = await session_repo.get_by_id(sid)
    if session is None or session.user_id != current_user.user_id:
        raise SessionNotFoundException()

    updated = await session_repo.update(session, title=request.title.strip())
    return SuccessResponse(data=SessionSummary.model_validate(updated))


@router.delete(
    "/sessions/{session_id}",
    response_model=SuccessResponse[DeleteSessionResponse],
    dependencies=[Depends(_read_limiter)],
    summary="Delete session",
    description="Permanently delete a chat session and all its messages.",
    responses=error_responses(401, 404, 429, 500),
)
async def delete_session(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[DeleteSessionResponse]:
    """Delete a session and all its messages."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError as exc:
        raise InvalidSessionIDException() from exc

    session_repo = SessionRepository(db)
    session = await session_repo.get_by_id(sid)
    if session is None or session.user_id != current_user.user_id:
        raise SessionNotFoundException()

    await session_repo.delete(session)
    return SuccessResponse(data=DeleteSessionResponse(deleted=session_id))
