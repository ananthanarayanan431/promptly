"""
Two-stage Celery pipeline for domain prompt optimization.

Stage 1 — prepare_domain_dataset:
  PDF bytes → text extraction → LLM Q&A generation → JSONL stored in MinIO
  On success: marks domain completed (dataset ready); user optimizes on demand.

Stage 2 — run_domain_optimization:
  Loads JSONL from MinIO → scores prompt variants → saves winning prompt to DB.

Stage 3 — augment_domain_dataset (optional):
  Loads existing JSONL → generates N additional Q&A pairs → appends and saves.

All tasks follow the same Redis job lifecycle as process_chat_async:
  queued → started → completed | failed | cancelled

Cancel signal: POST /jobs/{job_id}/cancel or POST /{domain_id}/cancel sets a Redis
cancel flag; each task checks it between expensive stages and raises InterruptedError.
The cancel endpoint already updates DB + refunds credits before signalling, so the
worker simply exits without retrying on InterruptedError.
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

from promptly.utils.log import get_logger
from promptly.workers.celery_app import celery_app

_log = get_logger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def prepare_domain_dataset(
    self: Any,
    *,
    job_id: str,
    domain_id: str,
    user_id: str,
) -> None:
    async def _run() -> None:
        from uuid import UUID

        from promptly.config.app import get_app_settings
        from promptly.config.env import get_minio_settings
        from promptly.core.logging import setup_worker_logging
        from promptly.db.redis import reset_connection_pool
        from promptly.db.session import AsyncSessionLocal, dispose_async_engine
        from promptly.domain_prompt.core.dataset_builder import (
            extract_text_from_pdf,
            generate_qa_pairs,
            pairs_to_jsonl,
        )
        from promptly.domain_prompt.data.models import DomainPromptStatus
        from promptly.domain_prompt.data.repository import DomainPromptRepository
        from promptly.domain_prompt.infrastructure.cache import (
            clear_dp_domain_active_job,
            is_dp_job_cancelled,
            set_dp_celery_task_id,
            set_dp_domain_active_job,
            set_dp_job_domain_id,
            set_dp_job_result,
            set_dp_job_stage,
            set_dp_job_status,
        )
        from promptly.domain_prompt.infrastructure.storage import (
            download_bytes,
            object_key,
            upload_text,
        )
        from promptly.llm import get_llm_settings

        setup_worker_logging(debug=get_app_settings().DEBUG)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            job_id=job_id, user_id=user_id, domain_id=domain_id, task="prepare_domain_dataset"
        )
        _log.info("task_started")

        reset_connection_pool()
        await dispose_async_engine()

        # Register task for cancel support
        await set_dp_celery_task_id(job_id, self.request.id or "")
        await set_dp_job_domain_id(job_id, domain_id)
        await set_dp_domain_active_job(domain_id, job_id)

        await set_dp_job_status(job_id, "started")
        await set_dp_job_stage(job_id, "loading_pdf")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        is_terminal = False
        try:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is None:
                    raise ValueError(f"Domain {domain_id} not found")
                await repo.set_status(domain, DomainPromptStatus.preparing_dataset)
                await db.commit()

            # MinIO + LLM work outside the DB session to avoid greenlet conflict
            pdf_key = object_key(user_id, domain_id, "source.pdf")
            pdf_bytes = download_bytes(bucket, pdf_key)

            await set_dp_job_stage(job_id, "extracting_text")
            text = extract_text_from_pdf(pdf_bytes)

            # ── Cancel checkpoint: after cheap extraction, before expensive LLM call ──
            if await is_dp_job_cancelled(job_id):
                raise InterruptedError("Job cancelled by user before Q&A generation.")

            # Pass base_prompt so AutoData filtering can test weak vs strong solver
            await set_dp_job_stage(job_id, "generating_qa")
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain_for_prompt = await repo.get_by_id(UUID(domain_id))
                base_prompt_for_dataset = (
                    domain_for_prompt.base_prompt if domain_for_prompt is not None else None
                )
            pairs = await generate_qa_pairs(text, api_key, base_prompt=base_prompt_for_dataset)

            # ── Cancel checkpoint: after LLM generation, before MinIO write ──
            if await is_dp_job_cancelled(job_id):
                raise InterruptedError("Job cancelled by user after Q&A generation.")

            await set_dp_job_stage(job_id, "saving_dataset")

            if not pairs:
                raise ValueError("No Q&A pairs could be extracted from the PDF")

            jsonl = pairs_to_jsonl(pairs)
            dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
            upload_text(bucket, dataset_key, jsonl)

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain_with_ds = await repo.get_by_id(UUID(domain_id))
                if domain_with_ds is not None:
                    if domain_with_ds.dataset is not None:
                        await repo.update_dataset(
                            domain_with_ds.dataset,
                            dataset_key=dataset_key,
                            row_count=len(pairs),
                        )
                    else:
                        pdf_key = object_key(user_id, domain_id, "source.pdf")
                        await repo.save_dataset(
                            domain_id=domain_with_ds.id,
                            user_id=domain_with_ds.user_id,
                            bucket=bucket,
                            pdf_key=pdf_key,
                            dataset_key=dataset_key,
                            row_count=len(pairs),
                        )
                    await repo.set_status(domain_with_ds, DomainPromptStatus.completed)
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(job_id, {"domain_id": domain_id, "row_count": len(pairs)})

        except InterruptedError:
            # Cancel endpoint already updated DB/Redis + refunded credits; just exit.
            _log.info("task_cancelled", job_id=job_id)
            return

        except Exception as exc:
            is_terminal = isinstance(exc, ValueError)

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is not None:
                    await repo.set_status(
                        domain,
                        DomainPromptStatus.failed,
                        error_message=str(exc)[:500],
                    )
                    await db.commit()

            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": "Internal server error"})

            if is_terminal:
                try:
                    from uuid import UUID as _UUID

                    from promptly.repositories.user_repo import UserRepository as _UserRepo

                    async with AsyncSessionLocal() as refund_db:
                        _repo = _UserRepo(refund_db)
                        await _repo.refund_credits(_UUID(user_id), 10)
                        await refund_db.commit()
                except Exception:  # noqa: BLE001
                    _log.exception("credit_refund_failed", user_id=user_id)

                raise exc

            raise self.retry(exc=exc) from exc
        finally:
            await clear_dp_domain_active_job(domain_id)
            await dispose_async_engine()

    asyncio.run(_run())


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def run_domain_optimization(
    self: Any,
    *,
    job_id: str,
    domain_id: str,
    user_id: str,
    prompt_to_optimize: str,
) -> None:
    async def _run() -> None:
        import json
        from typing import Any, cast
        from uuid import UUID

        from promptly.config.app import get_app_settings
        from promptly.config.env import get_minio_settings
        from promptly.core.logging import setup_worker_logging
        from promptly.db.redis import reset_connection_pool
        from promptly.db.session import AsyncSessionLocal, dispose_async_engine
        from promptly.domain_prompt.core.optimizer import optimize_domain_prompt
        from promptly.domain_prompt.data.models import DomainPromptStatus
        from promptly.domain_prompt.data.repository import (
            DomainOptimizationRunRepository,
            DomainPromptRepository,
        )
        from promptly.domain_prompt.infrastructure.cache import (
            clear_dp_domain_active_job,
            clear_dp_tournament_state,
            is_dp_job_cancelled,
            set_dp_celery_task_id,
            set_dp_domain_active_job,
            set_dp_job_domain_id,
            set_dp_job_result,
            set_dp_job_status,
        )
        from promptly.domain_prompt.infrastructure.storage import (
            download_text,
            object_key,
            upload_text,
        )
        from promptly.llm import get_llm_settings

        setup_worker_logging(debug=get_app_settings().DEBUG)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            job_id=job_id, user_id=user_id, domain_id=domain_id, task="run_domain_optimization"
        )
        _log.info("task_started")

        reset_connection_pool()
        await dispose_async_engine()

        # Register task for cancel support
        await set_dp_celery_task_id(job_id, self.request.id or "")
        await set_dp_job_domain_id(job_id, domain_id)
        await set_dp_domain_active_job(domain_id, job_id)

        await set_dp_job_status(job_id, "started")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        is_terminal = False
        try:
            await clear_dp_tournament_state(domain_id)

            dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
            dataset_jsonl = download_text(bucket, dataset_key)

            # ── Cancel checkpoint: before the expensive tournament ──
            if await is_dp_job_cancelled(job_id):
                raise InterruptedError("Job cancelled by user before tournament.")

            result: dict[str, Any] = cast(
                dict[str, Any],
                await optimize_domain_prompt(
                    base_prompt=prompt_to_optimize,
                    dataset_jsonl=dataset_jsonl,
                    api_key=api_key,
                    domain_id=domain_id,
                    # Per-round cancel check lets the tournament exit cleanly mid-run
                    cancel_check=lambda: is_dp_job_cancelled(job_id),
                ),
            )

            result_key = object_key(user_id, domain_id, "result.json")
            upload_text(bucket, result_key, json.dumps(result, indent=2))

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is None:
                    raise ValueError(f"Domain {domain_id} not found")
                await repo.set_status(domain, DomainPromptStatus.completed)

                run_repo = DomainOptimizationRunRepository(db)
                dataset_size: int | None = None
                if domain.dataset is not None:
                    dataset_size = domain.dataset.row_count
                score_before: float = float(result.get("score_before", 0.0))
                score_after: float = float(result.get("score_after", 0.0))
                win_rate: float = float(result.get("win_rate", 0.0))
                candidates_tried: int = int(result.get("candidates_tried", 1))
                rounds_run: int = int(result.get("rounds_run", 40))
                optimized_prompt: str = str(result.get("optimized_prompt", prompt_to_optimize))
                await run_repo.create_run(
                    domain_id=domain.id,
                    domain_name=domain.name,
                    prompt_input=prompt_to_optimize,
                    optimized_prompt=optimized_prompt,
                    score_before=score_before,
                    score_after=score_after,
                    win_rate=win_rate,
                    candidates_tried=candidates_tried,
                    rounds_run=rounds_run,
                    dataset_size=dataset_size,
                )
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(
                job_id,
                {
                    "domain_id": domain_id,
                    "optimized_prompt": optimized_prompt,
                    "score_before": score_before,
                    "score_after": score_after,
                    "win_rate": win_rate,
                    "candidates_tried": candidates_tried,
                },
            )

        except InterruptedError:
            # Cancel endpoint already updated DB/Redis + refunded credits; just exit.
            _log.info("task_cancelled", job_id=job_id)
            return

        except Exception as exc:
            is_terminal = isinstance(exc, ValueError)
            error_str = str(exc)[:500]

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is not None:
                    await repo.set_status(
                        domain,
                        DomainPromptStatus.failed,
                        error_message=error_str,
                    )
                    run_repo = DomainOptimizationRunRepository(db)
                    _dataset_size: int | None = None
                    if domain.dataset is not None:
                        _dataset_size = domain.dataset.row_count
                    await run_repo.create_run(
                        domain_id=domain.id,
                        domain_name=domain.name,
                        prompt_input=prompt_to_optimize,
                        status="failed",
                        error_message=error_str,
                        dataset_size=_dataset_size,
                    )
                    await db.commit()

            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": "Internal server error"})

            if is_terminal:
                try:
                    from uuid import UUID as _UUID

                    from promptly.repositories.user_repo import UserRepository as _UserRepo

                    async with AsyncSessionLocal() as refund_db:
                        _repo = _UserRepo(refund_db)
                        await _repo.refund_credits(_UUID(user_id), 10)
                        await refund_db.commit()
                except Exception:  # noqa: BLE001
                    _log.exception("credit_refund_failed", user_id=user_id)

                raise exc

            raise self.retry(exc=exc) from exc
        finally:
            try:
                await clear_dp_tournament_state(domain_id)
            except Exception:  # noqa: BLE001
                _log.warning("tournament_state_clear_failed", domain_id=domain_id)
            await clear_dp_domain_active_job(domain_id)
            await dispose_async_engine()

    asyncio.run(_run())


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def augment_domain_dataset(
    self: Any,
    *,
    job_id: str,
    domain_id: str,
    user_id: str,
    count: int = 10,
) -> None:
    async def _run() -> None:
        import json
        from uuid import UUID

        from promptly.config.app import get_app_settings
        from promptly.config.env import get_minio_settings
        from promptly.core.logging import setup_worker_logging
        from promptly.db.redis import reset_connection_pool
        from promptly.db.session import AsyncSessionLocal, dispose_async_engine
        from promptly.domain_prompt.core.dataset_builder import generate_qa_pairs, pairs_to_jsonl
        from promptly.domain_prompt.data.models import DomainPromptStatus
        from promptly.domain_prompt.data.repository import DomainPromptRepository
        from promptly.domain_prompt.infrastructure.cache import (
            clear_dp_domain_active_job,
            is_dp_job_cancelled,
            set_dp_celery_task_id,
            set_dp_domain_active_job,
            set_dp_job_domain_id,
            set_dp_job_result,
            set_dp_job_status,
        )
        from promptly.domain_prompt.infrastructure.storage import (
            download_text,
            object_key,
            upload_text,
        )
        from promptly.llm import get_llm_settings

        setup_worker_logging(debug=get_app_settings().DEBUG)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            job_id=job_id, user_id=user_id, domain_id=domain_id, task="augment_domain_dataset"
        )
        _log.info("task_started")

        reset_connection_pool()
        await dispose_async_engine()

        # Register task for cancel support
        await set_dp_celery_task_id(job_id, self.request.id or "")
        await set_dp_job_domain_id(job_id, domain_id)
        await set_dp_domain_active_job(domain_id, job_id)

        await set_dp_job_status(job_id, "started")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        try:
            dataset_key_val = object_key(user_id, domain_id, "dataset.jsonl")
            try:
                existing_jsonl = download_text(bucket, dataset_key_val)
            except Exception:  # noqa: BLE001
                existing_jsonl = ""

            existing_pairs: list[dict[str, str]] = []
            for line in existing_jsonl.strip().splitlines():
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict) and "question" in obj and "answer" in obj:
                        existing_pairs.append(obj)
                except Exception:  # noqa: BLE001, S112
                    continue

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain_obj = await repo.get_by_id(UUID(domain_id))
                base_prompt_for_aug = domain_obj.base_prompt if domain_obj is not None else None

            # ── Cancel checkpoint: before the expensive LLM call ──
            if await is_dp_job_cancelled(job_id):
                raise InterruptedError("Augment job cancelled by user.")

            context_text = "\n".join(
                f"Q: {p['question']}\nA: {p['answer']}" for p in existing_pairs[:20]
            )
            new_pairs = await generate_qa_pairs(
                context_text or "Generate general domain Q&A.",
                api_key,
                base_prompt=base_prompt_for_aug,
            )

            # ── Cancel checkpoint: after LLM call, before writing to MinIO ──
            if await is_dp_job_cancelled(job_id):
                raise InterruptedError("Augment job cancelled by user after generation.")

            existing_qs = {p["question"].strip().lower() for p in existing_pairs}
            added = [p for p in new_pairs if p["question"].strip().lower() not in existing_qs]
            added = added[:count]

            merged = existing_pairs + added
            upload_text(bucket, dataset_key_val, pairs_to_jsonl(merged))

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is not None:
                    if domain.dataset is not None:
                        await repo.update_dataset(
                            domain.dataset,
                            dataset_key=dataset_key_val,
                            row_count=len(merged),
                        )
                    else:
                        pdf_key = object_key(user_id, domain_id, "source.pdf")
                        await repo.save_dataset(
                            domain_id=domain.id,
                            user_id=domain.user_id,
                            bucket=bucket,
                            pdf_key=pdf_key,
                            dataset_key=dataset_key_val,
                            row_count=len(merged),
                        )
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(
                job_id,
                {"domain_id": domain_id, "added": len(added), "total": len(merged)},
            )

        except InterruptedError:
            # Augment is free; cancel endpoint already updated Redis. Just exit.
            _log.info("augment_task_cancelled", job_id=job_id)
            await set_dp_job_status(job_id, "cancelled")
            return

        except Exception as exc:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain_failed = await repo.get_by_id(UUID(domain_id))
                if domain_failed is not None:
                    await repo.set_status(
                        domain_failed,
                        DomainPromptStatus.failed,
                        error_message=str(exc)[:500],
                    )
                    await db.commit()

            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": "Internal server error"})
            if isinstance(exc, ValueError):
                raise exc
            raise self.retry(exc=exc) from exc
        finally:
            await clear_dp_domain_active_job(domain_id)
            await dispose_async_engine()

    asyncio.run(_run())
