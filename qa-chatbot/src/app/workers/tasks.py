"""
Celery tasks — runs inside worker processes, NOT inside the FastAPI process.

Key design decisions:
  - The worker builds its own LangGraph instance (the FastAPI app lifespan never
    runs in a worker process, so app.state.graph is never populated there).
  - asyncio.run() is safe here because Celery workers are separate OS processes
    and worker_prefetch_multiplier=1 ensures one task runs at a time per worker.
  - Job lifecycle is tracked in Redis (queued → started → completed | failed)
    so the FastAPI poll endpoint can serve results without touching Celery internals.
"""

import asyncio
from typing import Any

from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)  # type: ignore[untyped-decorator]
def process_chat_async(
    self: Any,
    *,
    job_id: str,
    user_id: str,
    raw_prompt: str,
    session_id: str,
    feedback: str | None = None,
    prompt_id: str | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    """
    Run the full LangGraph council pipeline as a background job.

    Versioning behaviour:
      - prompt_id supplied → save optimized result as the next version of that family
      - name supplied (no prompt_id) → create / append a named version family:
            if the name is new  → save original as v1, optimized as v2
            if the name exists  → save optimized as vN+1

    Lifecycle written to Redis:
        queued   (set by the API endpoint before dispatching)
        started  (set here at task entry)
        completed / failed  (set here at task exit)
    """

    def _fallback_title(text: str) -> str:
        """Truncate raw_prompt to a readable title as a safe fallback (≤ 80 chars)."""
        if len(text) <= 80:
            return text
        truncated = text[:77]
        last_space = truncated.rfind(" ")
        if last_space > 40:
            truncated = truncated[:last_space]
        return truncated + "..."

    async def _generate_title(text: str, api_key: str) -> str:
        """Ask a fast LLM to produce a short, meaningful session title (4-6 words)."""
        from langchain_openai import ChatOpenAI

        model = ChatOpenAI(
            model="openai/gpt-4o-mini",
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=api_key,
            max_tokens=20,
            temperature=0,
        )
        response = await model.ainvoke(
            [
                {
                    "role": "system",
                    "content": (
                        "Generate a short 4–6 word title that captures the purpose of the "
                        "following prompt. Return ONLY the title — no quotes, no punctuation "
                        "at the end, no explanation."
                    ),
                },
                {"role": "user", "content": text[:500]},
            ]
        )
        title = str(response.content).strip().strip('"').strip("'")
        return title[:100] if title else _fallback_title(text)

    async def _run() -> dict[str, Any]:
        import uuid as uuid_mod
        from uuid import UUID

        from app.config.llm import get_llm_settings
        from app.core.cache import set_job_result, set_job_status
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine

        # Redis + SQLAlchemy pools are bound to the previous event loop (closed by the
        # last asyncio.run()). Reset so fresh connections attach to this loop.
        reset_connection_pool()
        await dispose_async_engine()
        from app.graph.builder import compile_graph
        from app.graph.checkpointer import get_checkpointer
        from app.repositories.prompt_version_repo import PromptVersionRepository
        from app.repositories.session_repo import SessionRepository
        from app.services.chat_service import ChatService

        await set_job_status(job_id, "started")

        llm_settings = get_llm_settings()
        api_key = llm_settings.OPENROUTER_API_KEY.get_secret_value()

        try:
            async with AsyncSessionLocal() as db:
                async with get_checkpointer() as checkpointer:
                    graph = await compile_graph(checkpointer)
                    service = ChatService(db=db, graph=graph)

                    # Run the optimization pipeline and the title LLM call concurrently.
                    # Title generation is fire-and-forget — any failure falls back gracefully.
                    title_task = asyncio.create_task(_generate_title(raw_prompt, api_key))

                    result = await service.process(
                        user_id=user_id,
                        raw_prompt=raw_prompt,
                        session_id=session_id,
                        feedback=feedback,
                        title=_fallback_title(raw_prompt),  # initial placeholder
                    )

                # Always commit session + message immediately so they're visible
                # to the frontend (sidebar history, refresh) before the title
                # LLM call or versioning completes.
                await db.commit()

                # Update session title with the LLM-generated value (best-effort)
                try:
                    llm_title = await asyncio.wait_for(title_task, timeout=10.0)
                    session_repo = SessionRepository(db)
                    session = await session_repo.get_by_thread_id(session_id)
                    if session:
                        await session_repo.update(session, title=llm_title)
                        await db.commit()
                except Exception:  # noqa: S110
                    pass  # Keep the fallback title — non-critical

                # --- Versioning save (same DB session, after pipeline) ---
                saved_prompt_id: str | None = None
                saved_version: int | None = None

                if prompt_id or name:
                    version_repo = PromptVersionRepository(db)

                    if prompt_id:
                        # Append to existing version family
                        pid = UUID(prompt_id)
                        latest = await version_repo.get_latest_by_prompt_id(pid, UUID(user_id))
                        next_ver = (latest.version + 1) if latest else 1
                        vname = name or (latest.name if latest else "unnamed")

                        v = await version_repo.create_version(
                            prompt_id=pid,
                            user_id=UUID(user_id),
                            name=vname,
                            version=next_ver,
                            content=result["optimized_prompt"],
                        )
                    else:
                        # name supplied without prompt_id
                        existing = await version_repo.get_latest_by_name(name, UUID(user_id))  # type: ignore[arg-type]
                        if existing:
                            # Append to the existing family
                            pid = existing.prompt_id
                            v = await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=name,  # type: ignore[arg-type]
                                version=existing.version + 1,
                                content=result["optimized_prompt"],
                            )
                        else:
                            # Brand-new family: v1 = original, v2 = optimized
                            pid = uuid_mod.uuid4()
                            await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=name,  # type: ignore[arg-type]
                                version=1,
                                content=raw_prompt,
                            )
                            v = await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=name,  # type: ignore[arg-type]
                                version=2,
                                content=result["optimized_prompt"],
                            )

                    await db.commit()
                    saved_prompt_id = str(v.prompt_id)
                    saved_version = v.version

                result["prompt_id"] = saved_prompt_id
                result["version"] = saved_version

            await set_job_result(job_id, result)
            await set_job_status(job_id, "completed")

            # Fire-and-forget silent health scoring (no credits charged)
            score_prompt_async.apply_async(
                kwargs={
                    "user_id": user_id,
                    "optimized_prompt": result.get("optimized_prompt", ""),
                }
            )

            return result

        except Exception as exc:
            await set_job_status(job_id, "failed")
            await set_job_result(job_id, {"error": str(exc)})
            raise self.retry(exc=exc) from exc

    try:
        return asyncio.run(_run())
    except Exception as exc:
        # Retry limit exhausted — status already written to Redis as "failed"
        raise exc


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def score_prompt_async(
    self: Any,
    *,
    user_id: str,
    optimized_prompt: str,
) -> None:
    """
    Silently compute a health score for an optimized prompt and persist it.
    No credits are charged. Failures are swallowed after retries — this is
    best-effort telemetry to power the quality trend chart.
    """

    async def _run() -> None:
        import logging
        from uuid import UUID

        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.repositories.health_score_repo import HealthScoreRepository
        from app.services.prompt_service import PromptService

        reset_connection_pool()
        await dispose_async_engine()

        log = logging.getLogger(__name__)
        try:
            async with AsyncSessionLocal() as db:
                service = PromptService(db)
                scores = await service.health_score(optimized_prompt, user_id)
                overall: float = float(scores.get("overall_score", 0.0))
                repo = HealthScoreRepository(db)
                await repo.save_score(
                    user_id=UUID(user_id),
                    overall_score=overall,
                    prompt_text=optimized_prompt[:2000],
                )
                await db.commit()
        except Exception as exc:
            log.warning("score_prompt_async failed (will retry): %s", exc)
            raise self.retry(exc=exc) from exc

    try:
        asyncio.run(_run())
    except Exception:  # noqa: S110
        pass  # Exhausted retries — silently discard, non-critical
