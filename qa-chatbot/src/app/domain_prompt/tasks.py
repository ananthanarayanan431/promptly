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
  queued → started → completed | failed
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.workers.celery_app import celery_app

_log = logging.getLogger(__name__)


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
                if domain_with_ds is not None:
                    await repo.set_status(domain_with_ds, DomainPromptStatus.completed)
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(job_id, {"domain_id": domain_id, "row_count": len(pairs)})

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
                # Refund only on terminal failure — transient failures may succeed on retry
                try:
                    from uuid import UUID as _UUID

                    from app.repositories.user_repo import UserRepository as _UserRepo

                    async with AsyncSessionLocal() as refund_db:
                        _repo = _UserRepo(refund_db)
                        await _repo.refund_credits(_UUID(user_id), 10)
                        await refund_db.commit()
                except Exception:  # noqa: BLE001
                    _log.exception(
                        "Failed to refund credits for user %s after terminal failure", user_id
                    )

                raise exc

            raise self.retry(exc=exc) from exc
        finally:
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

        is_terminal = False
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
                    win_rate=float(result["win_rate"]),  # type: ignore[arg-type]
                    candidates_tried=int(str(result["candidates_tried"])),
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
                    "win_rate": float(result["win_rate"]),  # type: ignore[arg-type]
                    "candidates_tried": int(str(result["candidates_tried"])),
                },
            )

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
                # Refund only on terminal failure — transient failures may succeed on retry
                try:
                    from uuid import UUID as _UUID

                    from app.repositories.user_repo import UserRepository as _UserRepo

                    async with AsyncSessionLocal() as refund_db:
                        _repo = _UserRepo(refund_db)
                        await _repo.refund_credits(_UUID(user_id), 10)
                        await refund_db.commit()
                except Exception:  # noqa: BLE001
                    _log.exception(
                        "Failed to refund credits for user %s after terminal failure", user_id
                    )

                raise exc

            raise self.retry(exc=exc) from exc
        finally:
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

        from app.config.env import get_minio_settings
        from app.config.llm import get_llm_settings
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.domain_prompt.cache import set_dp_job_result, set_dp_job_status
        from app.domain_prompt.dataset_builder import generate_qa_pairs, pairs_to_jsonl
        from app.domain_prompt.repository import DomainPromptRepository
        from app.domain_prompt.storage import download_text, object_key, upload_text

        reset_connection_pool()
        await dispose_async_engine()
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

            # Use existing Q&A as context to generate topically consistent new pairs
            context_text = "\n".join(
                f"Q: {p['question']}\nA: {p['answer']}" for p in existing_pairs[:20]
            )
            new_pairs = await generate_qa_pairs(
                context_text or "Generate general domain Q&A.", api_key
            )

            existing_qs = {p["question"].strip().lower() for p in existing_pairs}
            added = [p for p in new_pairs if p["question"].strip().lower() not in existing_qs]
            added = added[:count]

            merged = existing_pairs + added
            upload_text(bucket, dataset_key_val, pairs_to_jsonl(merged))

            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is not None and domain.dataset is not None:
                    await repo.update_dataset(
                        domain.dataset,
                        dataset_key=dataset_key_val,
                        row_count=len(merged),
                    )
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(
                job_id,
                {"domain_id": domain_id, "added": len(added), "total": len(merged)},
            )

        except Exception as exc:
            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": "Internal server error"})
            if isinstance(exc, ValueError):
                raise exc
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    asyncio.run(_run())
