import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.chat import (
    ChatInsufficientCreditsException,
    InvalidSessionIDException,
    JobNotFoundException,
    LLMTimeoutException,
    SessionNotFoundException,
    VersionedPromptNotFoundException,
)
from app.core.cache import (
    get_job_owner,
    get_job_progress_from,
    get_job_result,
    get_job_status,
    set_job_owner,
    set_job_status,
)
from app.dependencies import get_current_user, get_db
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.repositories.message_repo import MessageRepository
from app.repositories.prompt_version_repo import PromptVersionRepository
from app.repositories.session_repo import SessionRepository
from app.repositories.user_repo import UserRepository
from app.schemas.chat import (
    ChatJobAcceptedResponse,
    ChatRequest,
    ChatResponse,
    JobPollResponse,
    MessageOut,
    RecentSessionsResponse,
    RecentSessionWithPrompt,
    SaveVersionRequest,
    SaveVersionResponse,
    SessionDetailResponse,
    SessionsGroupedResponse,
    SessionSummary,
    SuggestNameRequest,
    SuggestNameResponse,
)
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
        raise ChatInsufficientCreditsException()

    # Resolve prompt content and versioning context
    raw_prompt: str
    resolved_prompt_id: str | None = None
    resolved_name: str | None = request.name

    if request.prompt_id:
        version_repo = PromptVersionRepository(db)
        latest = await version_repo.get_latest_by_prompt_id(request.prompt_id, current_user.id)
        if latest is None:
            raise VersionedPromptNotFoundException()
        raw_prompt = latest.content
        resolved_prompt_id = str(request.prompt_id)
        resolved_name = resolved_name or latest.name
    else:
        raw_prompt = request.prompt  # type: ignore[assignment]  # validated: one must exist

    # Atomic credit deduction: single UPDATE … WHERE credits >= 10 eliminates the
    # race condition where two concurrent requests both pass the balance check above.
    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, 10)
    if not deducted:
        raise ChatInsufficientCreditsException()
    await db.flush()

    job_id = str(uuid.uuid4())
    session_id = str(request.session_id) if request.session_id else str(uuid.uuid4())

    await set_job_status(job_id, "queued")
    await set_job_owner(job_id, str(current_user.id))

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
        raise JobNotFoundException()

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
)
async def stream_job_progress(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """
    SSE stream of real-time pipeline progress events.

    Streams JSON events as ``data: {...}\\n\\n`` until the job completes or fails.
    The terminal ``completed`` event embeds the full result so no second fetch is needed.
    Poll interval on the server side: 250 ms.
    """
    owner = await get_job_owner(job_id)
    if owner is None or owner != str(current_user.id):
        raise JobNotFoundException()

    async def generate() -> AsyncGenerator[str, None]:
        # 120 s ceiling prevents open connections if the worker crashes mid-job
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 120
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
    response_model=SuccessResponse[SuggestNameResponse],
)
async def suggest_prompt_name(
    request: SuggestNameRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[SuggestNameResponse]:
    """
    Generate a short ALL-CAPS version name (2–4 words) for a given prompt text.
    Used by the frontend versioning toggle in the chat input.
    """
    from langchain_openai import ChatOpenAI

    from app.config.llm import get_llm_settings

    llm_settings = get_llm_settings()
    api_key = llm_settings.OPENROUTER_API_KEY.get_secret_value()

    model = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        max_tokens=15,
        temperature=0,
    )
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
    response_model=SuccessResponse[SaveVersionResponse],
)
async def save_version_from_response(
    request: SaveVersionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[SaveVersionResponse]:
    """
    Save a prompt + its optimized response as v1 + v2 of a new version family.
    An ALL-CAPS name is generated automatically via LLM.
    Returns the prompt_id to pass in subsequent chat requests so each new
    optimized result is appended as v3, v4, …
    """
    import uuid as uuid_mod

    from langchain_openai import ChatOpenAI

    from app.config.llm import get_llm_settings
    from app.repositories.prompt_version_repo import PromptVersionRepository

    llm_settings = get_llm_settings()
    api_key = llm_settings.OPENROUTER_API_KEY.get_secret_value()

    model = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        max_tokens=15,
        temperature=0,
    )
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

    prompt_id = uuid_mod.uuid4()
    version_repo = PromptVersionRepository(db)

    await version_repo.create_version(
        prompt_id=prompt_id,
        user_id=current_user.id,
        name=name,
        version=1,
        content=request.original_prompt,
    )
    await version_repo.create_version(
        prompt_id=prompt_id,
        user_id=current_user.id,
        name=name,
        version=2,
        content=request.optimized_prompt,
    )
    await db.commit()

    return SuccessResponse(data=SaveVersionResponse(prompt_id=str(prompt_id), name=name, version=2))


@router.get(
    "/sessions",
    response_model=SuccessResponse[SessionsGroupedResponse],
)
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[SessionsGroupedResponse]:
    """
    Return this user's chat sessions grouped by recency: today / last 7 days /
    last 30 days / older.  Sessions without a title (never completed a run) are
    excluded.
    """
    session_repo = SessionRepository(db)
    sessions = await session_repo.get_by_user_id(current_user.id, limit=100)

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
        if not s.title:  # skip sessions with no title (no run completed yet)
            continue
        grouped[_bucket(s)].append(SessionSummary.model_validate(s))

    return SuccessResponse(data=SessionsGroupedResponse(**grouped))


@router.get(
    "/sessions/recent",
    response_model=SuccessResponse[RecentSessionsResponse],
)
async def get_recent_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
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
        .where(ChatSession.user_id == current_user.id, ChatSession.title.isnot(None))
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
)
async def get_session(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[SessionDetailResponse]:
    """Return a specific session with all its messages (chronological order)."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError as exc:
        raise InvalidSessionIDException() from exc

    session_repo = SessionRepository(db)
    session = await session_repo.get_by_id(sid)
    if session is None or session.user_id != current_user.id:
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
