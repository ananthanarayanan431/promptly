"""Celery task for SkillOpt optimization."""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

from promptly.utils.log import get_logger
from promptly.workers.celery_app import celery_app

_log = get_logger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def run_skillopt(
    self: Any,
    *,
    job_id: str,
    project_id: str,
    user_id: str,
    budget_tier: str = "medium",
    llm_effort: str | None = None,
) -> None:
    async def _run() -> None:
        import json
        from uuid import UUID

        from promptly.config.app import get_app_settings
        from promptly.config.env import get_minio_settings
        from promptly.core.logging import setup_worker_logging
        from promptly.db.redis import reset_connection_pool
        from promptly.db.session import AsyncSessionLocal, dispose_async_engine
        from promptly.llm import get_llm_settings
        from promptly.repositories.user_repo import UserRepository
        from promptly.skill_opt.core.skillopt import optimize_skill
        from promptly.skill_opt.data.models import SkillOptStatus
        from promptly.skill_opt.data.repository import SkillOptProjectRepository
        from promptly.skill_opt.infrastructure.cache import (
            clear_so_live_state,
            is_so_job_cancelled,
            set_so_job_result,
            set_so_job_status,
            set_so_live_state,
        )
        from promptly.skill_opt.infrastructure.storage import (
            download_text,
            examples_key,
            skill_key,
            upload_text,
        )

        setup_worker_logging(debug=get_app_settings().DEBUG)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            job_id=job_id,
            project_id=project_id,
            user_id=user_id,
            task="run_skillopt",
        )
        _log.info("skillopt_task_started")

        reset_connection_pool()
        await dispose_async_engine()

        await set_so_job_status(job_id, "started")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        is_terminal = False
        credits_to_refund = {"low": 5, "medium": 10, "high": 16}.get(budget_tier, 10)

        try:
            await clear_so_live_state(project_id)

            # Load examples from MinIO
            ex_key = examples_key(user_id, project_id)
            examples_jsonl = download_text(bucket, ex_key)
            examples = []
            for line in examples_jsonl.strip().splitlines():
                try:
                    obj = json.loads(line)
                    if "input" in obj and "expected" in obj:
                        examples.append(obj)
                except Exception:  # noqa: BLE001, S112
                    continue

            if len(examples) < 6:
                raise ValueError(f"SkillOpt needs at least 6 examples; found {len(examples)}.")

            if await is_so_job_cancelled(job_id):
                raise InterruptedError("Cancelled before optimization.")

            # Read task description from DB
            async with AsyncSessionLocal() as db:
                repo = SkillOptProjectRepository(db)
                project = await repo.get_by_id(UUID(project_id))
                if project is None:
                    raise ValueError(f"Project {project_id} not found.")
                task_description = project.task_description

            # Emit live state helper
            async def emit(state: dict[str, Any]) -> None:
                await set_so_live_state(project_id, state)

            result = await optimize_skill(
                task_description=task_description,
                examples=examples,
                api_key=api_key,
                budget_tier=budget_tier,
                llm_effort=llm_effort,
                project_id=project_id,
                cancel_check=lambda: is_so_job_cancelled(job_id),
                emit_state=emit,
            )

            # Store best skill in MinIO
            sk = skill_key(user_id, project_id, "best_skill.md")
            upload_text(bucket, sk, result["best_skill"])
            seed_sk = skill_key(user_id, project_id, "seed_skill.md")
            upload_text(bucket, seed_sk, result["seed_skill"])

            # Persist epoch runs + update project
            async with AsyncSessionLocal() as db:
                repo = SkillOptProjectRepository(db)
                project = await repo.get_by_id(UUID(project_id))
                if project is None:
                    raise ValueError(f"Project {project_id} not found.")

                await repo.set_status(
                    project,
                    SkillOptStatus.completed,
                    seed_skill=result["seed_skill"],
                    best_skill=result["best_skill"],
                    score_before=result["score_before"],
                    score_after=result["score_after"],
                    epochs_run=result["epochs_run"],
                    edits_accepted=result["edits_accepted"],
                    edits_rejected=result["edits_rejected"],
                    example_count=result["example_count"],
                )

                for ep in result.get("epoch_results", []):
                    await repo.create_run(
                        project_id=UUID(project_id),
                        epoch=ep["epoch"],
                        score_before=ep["score_before"],
                        score_after=ep["score_after"],
                        edits_proposed=ep["edits_proposed"],
                        edits_accepted=ep["edits_accepted"],
                        edits_rejected=ep["edits_rejected"],
                        rollout_count=ep["rollout_count"],
                    )

                await db.commit()

            await set_so_job_status(job_id, "completed")
            await set_so_job_result(
                job_id,
                {
                    "project_id": project_id,
                    "best_skill": result["best_skill"],
                    "score_before": result["score_before"],
                    "score_after": result["score_after"],
                    "epochs_run": result["epochs_run"],
                    "edits_accepted": result["edits_accepted"],
                    "edits_rejected": result["edits_rejected"],
                },
            )

        except InterruptedError:
            _log.info("skillopt_task_cancelled")
            async with AsyncSessionLocal() as cancel_db:
                cancel_repo = SkillOptProjectRepository(cancel_db)
                cancel_project = await cancel_repo.get_by_id(UUID(project_id))
                if cancel_project is not None:
                    await cancel_repo.set_status(cancel_project, SkillOptStatus.cancelled)
                    await cancel_db.commit()
            await set_so_job_status(job_id, "cancelled")
            return

        except Exception as exc:
            is_terminal = isinstance(exc, ValueError)
            error_str = str(exc)[:500]
            _log.exception("skillopt_task_failed", error=error_str)

            async with AsyncSessionLocal() as db:
                repo = SkillOptProjectRepository(db)
                project = await repo.get_by_id(UUID(project_id))
                if project is not None:
                    await repo.set_status(project, SkillOptStatus.failed, error_message=error_str)
                    await db.commit()

            await set_so_job_status(job_id, "failed")
            await set_so_job_result(job_id, {"error": "Optimization failed."})

            if is_terminal:
                # Refund credits for unrecoverable errors
                try:
                    async with AsyncSessionLocal() as refund_db:
                        u_repo = UserRepository(refund_db)
                        await u_repo.refund_credits(UUID(user_id), credits_to_refund)
                        await refund_db.commit()
                except Exception:  # noqa: BLE001
                    _log.exception("skillopt_credit_refund_failed")
                raise exc

            raise self.retry(exc=exc) from exc

    asyncio.run(_run())
