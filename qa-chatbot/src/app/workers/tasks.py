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


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
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
) -> dict:
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

    async def _run() -> dict:
        import uuid as uuid_mod
        from uuid import UUID

        from app.core.cache import set_job_result, set_job_status
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal

        # The module-level Redis pool is bound to the previous event loop
        # (closed by the last asyncio.run()). Reset it so a fresh pool is
        # created for this event loop.
        reset_connection_pool()
        from app.graph.builder import compile_graph
        from app.graph.checkpointer import get_checkpointer
        from app.repositories.prompt_version_repo import PromptVersionRepository
        from app.services.chat_service import ChatService

        await set_job_status(job_id, "started")

        try:
            async with AsyncSessionLocal() as db:
                async with get_checkpointer() as checkpointer:
                    graph = await compile_graph(checkpointer)
                    service = ChatService(db=db, graph=graph)
                    result = await service.process(
                        user_id=user_id,
                        raw_prompt=raw_prompt,
                        session_id=session_id,
                        feedback=feedback,
                    )

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
