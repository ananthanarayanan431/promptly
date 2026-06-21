"""Optimize-slice Celery task: runs the LangGraph council pipeline in a worker."""

import asyncio
from typing import Any

import structlog

from promptly.utils.log import get_logger
from promptly.workers.celery_app import celery_app

log = get_logger(__name__)


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
    category_slug: str | None = None,
    force_optimize: bool = False,
    skip_quality_gate: bool = False,
    skip_subject_classifier: bool = False,
    llm_effort: str | None = None,
    council_models: list[str] | None = None,
    synthesizer_model: str | None = None,
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

    from promptly.config.app import get_app_settings
    from promptly.core.logging import setup_worker_logging

    setup_worker_logging(debug=get_app_settings().DEBUG)
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(job_id=job_id, user_id=user_id)
    log.info("task_started", session_id=session_id)

    def _fallback_title(text: str) -> str:
        """Truncate raw_prompt to a readable title as a safe fallback (≤ 80 chars)."""
        if len(text) <= 80:
            return text
        truncated = text[:77]
        last_space = truncated.rfind(" ")
        if last_space > 40:
            truncated = truncated[:last_space]
        return truncated + "..."

    async def _generate_title(text: str) -> str:
        """Ask a fast LLM to produce a short, meaningful session title (4-6 words)."""
        from promptly.llm.naming import build_naming_llm

        model = build_naming_llm()
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

        from promptly.core.cache import set_job_result, set_job_status
        from promptly.db.redis import reset_connection_pool
        from promptly.db.session import AsyncSessionLocal, dispose_async_engine
        from promptly.llm import get_llm_settings

        # Redis + SQLAlchemy pools are bound to the previous event loop (closed by the
        # last asyncio.run()). Reset so fresh connections attach to this loop.
        reset_connection_pool()
        await dispose_async_engine()
        from promptly.graph.builder import compile_graph
        from promptly.graph.checkpointer import get_checkpointer
        from promptly.optimize.core.service import ChatService
        from promptly.repositories.prompt_version_repo import PromptVersionRepository
        from promptly.repositories.session_repo import SessionRepository
        from promptly.repositories.usage_event_repo import UsageEventRepository
        from promptly.services.category_service import CategoryService

        await set_job_status(job_id, "started")

        llm_settings = get_llm_settings()
        max_iterations = llm_settings.MAX_REFINEMENT_ITERATIONS

        try:
            async with AsyncSessionLocal() as db:
                async with get_checkpointer() as checkpointer:
                    graph = await compile_graph(checkpointer)
                    service = ChatService(db=db, graph=graph)

                    # Resolve category metadata for the council/synthesize prompts.
                    # If the slug doesn't resolve we silently fall back to "general" behavior
                    # rather than fail the whole optimization.
                    cat_name: str | None = None
                    cat_description: str | None = None
                    cat_is_predefined: bool = False
                    if category_slug:
                        try:
                            from uuid import UUID as _UUID3

                            cat_service = CategoryService(db)
                            cat = await cat_service.resolve(
                                slug=category_slug, user_id=_UUID3(user_id)
                            )
                            if cat is not None:
                                cat_name = cat.name
                                cat_description = cat.description
                                cat_is_predefined = cat.is_predefined
                        except Exception:  # noqa: S110
                            pass

                    # Build version history diff when appending to an existing family.
                    # This gives council models trajectory context (what changed, what improved).
                    version_history_diff: str | None = None
                    try:
                        from uuid import UUID as _UUID2

                        version_repo = PromptVersionRepository(db)
                        versions: list[Any] = []
                        if prompt_id:
                            versions = await version_repo.get_all_by_prompt_id(
                                _UUID2(prompt_id), _UUID2(user_id)
                            )
                        elif name:
                            latest = await version_repo.get_latest_by_name(name, _UUID2(user_id))
                            if latest is not None:
                                versions = await version_repo.get_all_by_prompt_id(
                                    latest.prompt_id, _UUID2(user_id)
                                )
                        if len(versions) >= 2:
                            # Cap at the most recent 5 versions to keep the council prompt
                            # within reasonable token bounds for long-lived families.
                            recent = versions[-5:]
                            lines = []
                            if len(versions) > len(recent):
                                lines.append(
                                    f"(showing last {len(recent)} of {len(versions)} versions)"
                                )
                            for v in recent:
                                lines.append(
                                    f"v{v.version}: {v.content[:300]}"
                                    + ("..." if len(v.content) > 300 else "")
                                )
                            version_history_diff = "\n\n".join(lines)
                    except Exception:  # noqa: S110
                        pass  # Non-critical — proceed without history

                    # Run the optimization pipeline and the title LLM call concurrently.
                    # Title generation is fire-and-forget — any failure falls back gracefully.
                    title_task = asyncio.create_task(_generate_title(raw_prompt))

                    result = await service.process(
                        user_id=user_id,
                        raw_prompt=raw_prompt,
                        session_id=session_id,
                        feedback=feedback,
                        title=_fallback_title(raw_prompt),  # initial placeholder
                        job_id=job_id,
                        version_history_diff=version_history_diff,
                        max_iterations=max_iterations,
                        category_slug=category_slug,
                        category_name=cat_name,
                        category_description=cat_description,
                        category_is_predefined=cat_is_predefined,
                        force_optimize=force_optimize,
                        skip_quality_gate=skip_quality_gate,
                        skip_subject_classifier=skip_subject_classifier,
                        llm_effort=llm_effort,
                        council_models=council_models,
                        synthesizer_model=synthesizer_model,
                    )

                # Performance gate short-circuited — fewer tokens used, deducted accurately below.

                # Always commit session + message immediately so they're visible
                # to the frontend (sidebar history, refresh) before the title
                # LLM call or versioning completes.
                await db.commit()

                # Resolve LLM-generated title (best-effort; falls back to truncated prompt)
                llm_title: str = _fallback_title(raw_prompt)
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
                saved_prompt_version_id: str | None = None

                # Auto-generate a versioning entry for every chat that lacks explicit
                # versioning context. Use "SESSION:<id>" as a stable, unique family name
                # so follow-up optimizations on the same session append to the same family.
                # After saving, rename to the human-readable LLM-generated title.
                effective_name = name
                effective_prompt_id = prompt_id
                auto_versioned = False
                if not effective_prompt_id and not effective_name:
                    effective_name = f"SESSION:{session_id}"
                    auto_versioned = True

                if effective_prompt_id or effective_name:
                    version_repo = PromptVersionRepository(db)

                    if effective_prompt_id:
                        # Append to existing version family
                        pid = UUID(effective_prompt_id)
                        latest = await version_repo.get_latest_by_prompt_id(pid, UUID(user_id))
                        if latest is None:
                            raise ValueError(
                                f"prompt_id {effective_prompt_id} not found for this user"
                            )
                        next_ver = latest.version + 1
                        vname = effective_name or latest.name

                        v = await version_repo.create_version(
                            prompt_id=pid,
                            user_id=UUID(user_id),
                            name=vname,
                            version=next_ver,
                            content=result["optimized_prompt"],
                        )
                    else:
                        # name supplied without prompt_id; guaranteed non-None by outer condition
                        if effective_name is None:
                            raise RuntimeError("effective_name must not be None here")
                        existing = await version_repo.get_latest_by_name(
                            effective_name, UUID(user_id)
                        )
                        if existing:
                            # Append to the existing family
                            pid = existing.prompt_id
                            v = await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=effective_name,
                                version=existing.version + 1,
                                content=result["optimized_prompt"],
                            )
                        else:
                            # Brand-new family: v1 = original, v2 = optimized
                            pid = uuid_mod.uuid4()
                            await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=effective_name,
                                version=1,
                                content=raw_prompt,
                            )
                            v = await version_repo.create_version(
                                prompt_id=pid,
                                user_id=UUID(user_id),
                                name=effective_name,
                                version=2,
                                content=result["optimized_prompt"],
                            )

                    # For auto-created families, rename to the human-readable LLM title
                    if auto_versioned:
                        await version_repo.update_family_name(pid, UUID(user_id), llm_title)

                    # Back-patch the assistant message so session history carries both IDs
                    from promptly.repositories.message_repo import MessageRepository

                    msg_repo = MessageRepository(db)
                    last_msgs = await msg_repo.get_last_n(UUID(session_id), n=1)
                    if last_msgs:
                        await msg_repo.update(
                            last_msgs[0],
                            prompt_version_id=v.id,
                            prompt_family_id=v.prompt_id,
                        )

                    await db.commit()
                    saved_prompt_id = str(v.prompt_id)
                    saved_version = v.version
                    saved_prompt_version_id = str(v.id)

                result["prompt_id"] = saved_prompt_id
                result["version"] = saved_version
                result["prompt_version_id"] = saved_prompt_version_id

                # Log a usage event for this completed optimization.
                # Keyed to job_id so a Celery retry cannot double-count the log entry.
                # Deduct actual tokens used by the entire optimization pipeline.
                # Log first (idempotent), then deduct — so a retry never deducts before the
                # idempotency record exists.
                usage_repo = UsageEventRepository(db)
                await usage_repo.log(
                    user_id=UUID(user_id),
                    action="optimize",
                    credits_spent=0,
                    job_id=job_id,
                )

                total_tokens = (result.get("token_usage") or {}).get("total_tokens", 0)
                if total_tokens:
                    from promptly.repositories.user_repo import UserRepository as _TokRepo

                    _tok_repo = _TokRepo(db)
                    await _tok_repo.deduct_tokens(UUID(user_id), total_tokens)

                await db.commit()

            await set_job_result(job_id, result)
            await set_job_status(job_id, "completed")

            # Fire-and-forget silent health scoring (no credits charged). Wrap the enqueue so a
            # broker hiccup can't fall through to the failure handler below and wrongly flip an
            # already-completed job to "failed" + refund credits.
            try:
                from promptly.workers.tasks import score_prompt_async

                score_prompt_async.apply_async(
                    kwargs={
                        "user_id": user_id,
                        "optimized_prompt": result.get("optimized_prompt", ""),
                    }
                )
            except Exception as exc:
                log.warning("score_prompt_enqueue_failed", job_id=job_id, error=str(exc))

            return result

        except Exception as exc:
            log.error("task_failed", error=str(exc), exc_info=True)
            await set_job_status(job_id, "failed")
            await set_job_result(job_id, {"error": str(exc)})
            # No credits were pre-deducted — tokens are only deducted post-completion.
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        return asyncio.run(_run())
    except Exception as exc:
        # Retry limit exhausted — status already written to Redis as "failed"
        raise exc
