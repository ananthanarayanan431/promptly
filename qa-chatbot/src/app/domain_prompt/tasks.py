"""
Two-stage Celery pipeline for domain prompt optimization.

Stage 1 — prepare_domain_dataset:
  PDF bytes → text extraction → LLM Q&A generation → JSONL stored in MinIO
  On success: dispatches run_domain_optimization automatically.

Stage 2 — run_domain_optimization:
  Loads JSONL from MinIO → scores prompt variants → saves winning prompt to DB.

Both tasks follow the same Redis job lifecycle as process_chat_async:
  queued → started → completed | failed
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.workers.celery_app import celery_app


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

        from app.config.env import get_minio_settings
        from app.config.llm import get_llm_settings
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.domain_prompt.cache import set_dp_job_result, set_dp_job_status
        from app.domain_prompt.dataset_builder import (
            extract_text_from_pdf,
            generate_qa_pairs,
            pairs_to_jsonl,
        )
        from app.domain_prompt.models import DomainPromptStatus
        from app.domain_prompt.repository import DomainPromptRepository
        from app.domain_prompt.storage import download_bytes, object_key, upload_text

        reset_connection_pool()
        await dispose_async_engine()

        await set_dp_job_status(job_id, "started")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

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
            text = extract_text_from_pdf(pdf_bytes)
            pairs = await generate_qa_pairs(text, api_key)

            if not pairs:
                raise ValueError("No Q&A pairs could be extracted from the PDF")

            jsonl = pairs_to_jsonl(pairs)
            dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
            upload_text(bucket, dataset_key, jsonl)

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain_with_ds = await repo.get_by_id(UUID(domain_id))
                if domain_with_ds is not None and domain_with_ds.dataset is not None:
                    await repo.update_dataset(
                        domain_with_ds.dataset,
                        dataset_key=dataset_key,
                        row_count=len(pairs),
                    )
                await db.commit()

            run_domain_optimization.apply_async(
                kwargs={"job_id": job_id, "domain_id": domain_id, "user_id": user_id}
            )

        except Exception as exc:
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
            await set_dp_job_result(job_id, {"error": str(exc)})

            try:
                from uuid import UUID as _UUID

                from app.repositories.user_repo import UserRepository as _UserRepo

                async with AsyncSessionLocal() as refund_db:
                    _repo = _UserRepo(refund_db)
                    await _repo.refund_credits(_UUID(user_id), 10)
                    await refund_db.commit()
            except Exception:  # noqa: BLE001, S110
                pass  # Non-critical — original exception propagates

            # Don't retry terminal data errors — only transient failures
            _terminal = (ValueError,)
            if isinstance(exc, _terminal):
                raise exc
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise exc  # noqa: TRY201


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
        from uuid import UUID

        from app.config.env import get_minio_settings
        from app.config.llm import get_llm_settings
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.domain_prompt.cache import set_dp_job_result, set_dp_job_status
        from app.domain_prompt.models import DomainPromptStatus
        from app.domain_prompt.optimizer import optimize_domain_prompt
        from app.domain_prompt.repository import DomainPromptRepository
        from app.domain_prompt.storage import download_text, object_key, upload_text

        reset_connection_pool()
        await dispose_async_engine()

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        try:
            # MinIO work outside the DB session to avoid greenlet conflict
            dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
            dataset_jsonl = download_text(bucket, dataset_key)

            result = await optimize_domain_prompt(
                base_prompt=prompt_to_optimize,
                dataset_jsonl=dataset_jsonl,
                api_key=api_key,
            )

            result_key = object_key(user_id, domain_id, "result.json")
            upload_text(bucket, result_key, json.dumps(result, indent=2))

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is None:
                    raise ValueError(f"Domain {domain_id} not found")
                await repo.set_status(
                    domain,
                    DomainPromptStatus.completed,
                    optimized_prompt=str(result["optimized_prompt"]),
                    score_before=float(result["score_before"]),  # type: ignore[arg-type]
                    score_after=float(result["score_after"]),  # type: ignore[arg-type]
                )
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(
                job_id,
                {
                    "domain_id": domain_id,
                    "optimized_prompt": str(result["optimized_prompt"]),
                    "score_before": float(result["score_before"]),  # type: ignore[arg-type]
                    "score_after": float(result["score_after"]),  # type: ignore[arg-type]
                },
            )

        except Exception as exc:
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
            await set_dp_job_result(job_id, {"error": str(exc)})

            try:
                from uuid import UUID as _UUID

                from app.repositories.user_repo import UserRepository as _UserRepo

                async with AsyncSessionLocal() as refund_db:
                    _repo = _UserRepo(refund_db)
                    await _repo.refund_credits(_UUID(user_id), 10)
                    await refund_db.commit()
            except Exception:  # noqa: BLE001, S110
                pass  # Non-critical — original exception propagates

            # Don't retry terminal data errors — only transient failures
            _terminal = (ValueError,)
            if isinstance(exc, _terminal):
                raise exc
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise exc  # noqa: TRY201
