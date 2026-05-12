"""
Celery task for the PromptBridge transfer pipeline.

run_prompt_transfer
  Full run:   queued → calibrating → extracting_mapping → adapting → completed
  Reuse run:  queued → adapting → completed

All imports are deferred inside the async closure (same pattern as domain_prompt)
to avoid Celery worker bootstrap issues with async SQLAlchemy / event loops.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.workers.celery_app import celery_app

_log = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=1, default_retry_delay=30)  # type: ignore[untyped-decorator]
def run_prompt_transfer(
    self: Any,
    *,
    job_id: str,
    transfer_job_id: str,
    user_id: str,
    source_prompt: str,
    source_model: str,
    target_model: str,
    existing_mapping_id: str | None,
) -> None:
    """
    Main Celery task: run the full PromptBridge pipeline.

    If existing_mapping_id is provided → skip calibration, run adapter only.
    Otherwise → run MAP-RPE calibration for both source and target models,
    extract mapping, then adapt.
    """

    async def _run() -> None:
        from uuid import UUID

        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.llm import get_llm_settings
        from app.llm.prompt_bridge import (
            build_pb_adapter_llm,
            build_pb_eval_llm,
            build_pb_extractor_llm,
            build_pb_reflection_llm,
            build_pb_target_llm,
            build_pb_task_llm,
        )
        from app.prompt_bridge.core.map_rpe import run_map_rpe
        from app.prompt_bridge.core.transfer import adapt_prompt, run_transfer_pipeline
        from app.prompt_bridge.data.models import TransferJobStatus
        from app.prompt_bridge.data.repository import (
            PromptMappingRepository,
            TransferJobRepository,
        )
        from app.prompt_bridge.infrastructure.cache import (
            set_pb_job_progress,
            set_pb_job_result,
            set_pb_job_status,
        )

        reset_connection_pool()
        await dispose_async_engine()

        await set_pb_job_status(job_id, "started")

        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()

        try:
            async with AsyncSessionLocal() as db:
                job_repo = TransferJobRepository(db)
                job = await job_repo.get_by_id(UUID(transfer_job_id))
                if job is None:
                    raise ValueError(f"TransferJob {transfer_job_id} not found")
                await job_repo.set_status(job, TransferJobStatus.calibrating)
                await db.commit()

            mapping_id: UUID | None = None
            mapping_text: str = ""
            adapted: str = ""

            if existing_mapping_id is not None:
                # ── Reuse path: adapter only ───────────────────────────────
                await set_pb_job_status(job_id, "adapting")
                await set_pb_job_progress(job_id, {"stage": "adapting", "reused_mapping": True})

                async with AsyncSessionLocal() as db:
                    job_repo = TransferJobRepository(db)
                    job = await job_repo.get_by_id(UUID(transfer_job_id))
                    if job is None:
                        raise ValueError(f"TransferJob {transfer_job_id} not found")
                    await job_repo.set_status(job, TransferJobStatus.adapting)
                    await db.commit()

                async with AsyncSessionLocal() as db:
                    mapping_repo = PromptMappingRepository(db)
                    mapping = await mapping_repo.get_by_id_and_user(
                        UUID(existing_mapping_id), UUID(user_id)
                    )
                    if mapping is None:
                        raise ValueError(f"Mapping {existing_mapping_id} not found")
                    mapping_text = mapping.mapping_text
                    mapping_id = mapping.id
                    n_pairs = mapping.pair_count

                adapter_llm = build_pb_adapter_llm(api_key)
                adapted = await adapt_prompt(
                    source_prompt=source_prompt,
                    source_model=source_model,
                    target_model=target_model,
                    transfer_mapping=mapping_text,
                    n_pairs=n_pairs,
                    adapter_llm=adapter_llm,
                )

            else:
                # ── Full calibration path ──────────────────────────────────
                await set_pb_job_status(job_id, "calibrating")
                await set_pb_job_progress(
                    job_id, {"stage": "calibrating_source", "step": 0, "total": 2}
                )

                task_llm = build_pb_task_llm(api_key)
                source_target_llm = build_pb_target_llm(source_model, api_key)
                target_llm = build_pb_target_llm(target_model, api_key)
                eval_llm = build_pb_eval_llm(api_key)
                reflection_llm = build_pb_reflection_llm(api_key)
                extractor_llm = build_pb_extractor_llm(api_key)
                adapter_llm = build_pb_adapter_llm(api_key)

                # Calibrate source model
                async def _source_progress(step: int, total: int, score: float) -> None:
                    await set_pb_job_progress(
                        job_id,
                        {
                            "stage": "calibrating_source",
                            "step": step,
                            "total": total,
                            "best_score": round(score, 3),
                        },
                    )

                source_best = await run_map_rpe(
                    source_prompt=source_prompt,
                    target_model=source_model,
                    task_llm=task_llm,
                    target_llm=source_target_llm,
                    eval_llm=eval_llm,
                    reflection_llm=reflection_llm,
                    progress_cb=_source_progress,
                )

                await set_pb_job_progress(
                    job_id, {"stage": "calibrating_target", "step": 0, "total": 1}
                )

                # Calibrate target model
                async def _target_progress(step: int, total: int, score: float) -> None:
                    await set_pb_job_progress(
                        job_id,
                        {
                            "stage": "calibrating_target",
                            "step": step,
                            "total": total,
                            "best_score": round(score, 3),
                        },
                    )

                target_best = await run_map_rpe(
                    source_prompt=source_prompt,
                    target_model=target_model,
                    task_llm=task_llm,
                    target_llm=target_llm,
                    eval_llm=eval_llm,
                    reflection_llm=reflection_llm,
                    progress_cb=_target_progress,
                )

                # Extract mapping
                await set_pb_job_status(job_id, "extracting_mapping")
                await set_pb_job_progress(job_id, {"stage": "extracting_mapping"})

                async with AsyncSessionLocal() as db:
                    job_repo = TransferJobRepository(db)
                    job = await job_repo.get_by_id(UUID(transfer_job_id))
                    if job is None:
                        raise ValueError(f"TransferJob {transfer_job_id} not found")
                    await job_repo.set_status(job, TransferJobStatus.extracting_mapping)
                    await db.commit()

                mapping_text, adapted = await run_transfer_pipeline(
                    source_prompt=source_prompt,
                    source_model=source_model,
                    target_model=target_model,
                    source_optimal_prompt=source_best.text,
                    target_optimal_prompt=target_best.text,
                    extractor_llm=extractor_llm,
                    adapter_llm=adapter_llm,
                )

                # Persist mapping + pair
                async with AsyncSessionLocal() as db:
                    mapping_repo = PromptMappingRepository(db)
                    new_mapping = await mapping_repo.create(
                        user_id=UUID(user_id),
                        source_model=source_model,
                        target_model=target_model,
                        mapping_text=mapping_text,
                        pair_count=0,
                        avg_source_score=source_best.combined_score,
                        avg_target_score=target_best.combined_score,
                    )
                    await mapping_repo.add_pair(
                        new_mapping,
                        source_optimal=source_best.text,
                        target_optimal=target_best.text,
                        source_score=source_best.combined_score,
                        target_score=target_best.combined_score,
                    )
                    mapping_id = new_mapping.id
                    await db.commit()

            # ── Finalise job ───────────────────────────────────────────────
            await set_pb_job_status(job_id, "adapting")
            await set_pb_job_progress(job_id, {"stage": "adapting"})

            async with AsyncSessionLocal() as db:
                job_repo = TransferJobRepository(db)
                mapping_repo = PromptMappingRepository(db)
                job = await job_repo.get_by_id(UUID(transfer_job_id))
                if job is None:
                    raise ValueError(f"TransferJob {transfer_job_id} not found")
                await job_repo.set_status(
                    job,
                    TransferJobStatus.completed,
                    adapted_prompt=adapted,
                    mapping_id=mapping_id,
                )
                # Update mapping_text if we accumulated new pairs on reuse path
                if existing_mapping_id is not None and mapping_id is not None:
                    existing = await mapping_repo.get_by_id_and_user(mapping_id, UUID(user_id))
                    if existing is not None:
                        await mapping_repo.add_pair(
                            existing,
                            source_optimal=source_prompt,
                            target_optimal=adapted,
                        )
                await db.commit()

            result_data: dict[str, Any] = {
                "adapted_prompt": adapted,
                "source_model": source_model,
                "target_model": target_model,
                "mapping_id": str(mapping_id),
                "reused_mapping": existing_mapping_id is not None,
                "credits_charged": 1 if existing_mapping_id else 5,
            }
            await set_pb_job_result(job_id, result_data)
            await set_pb_job_status(job_id, "completed")
            await set_pb_job_progress(job_id, {"stage": "completed"})

        except Exception as exc:
            _log.exception("PromptBridge transfer failed: job_id=%s", job_id)
            error_str = str(exc)[:500]
            await set_pb_job_result(job_id, {"error": error_str})
            await set_pb_job_status(job_id, "failed")
            await set_pb_job_progress(job_id, {"stage": "failed", "error": error_str})

            try:
                async with AsyncSessionLocal() as db:
                    job_repo = TransferJobRepository(db)
                    job = await job_repo.get_by_id(UUID(transfer_job_id))
                    if job is not None:
                        await job_repo.set_status(
                            job,
                            TransferJobStatus.failed,
                            error_message=error_str,
                        )
                    await db.commit()
            except Exception:  # noqa: BLE001
                _log.exception("Failed to persist error state for job %s", transfer_job_id)

    asyncio.run(_run())
