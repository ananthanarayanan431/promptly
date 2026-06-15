"""
Celery tasks — runs inside worker processes, NOT inside the FastAPI process.

Hosts `score_prompt_async`, the best-effort silent health-scoring task. The
optimize council pipeline (`process_chat_async`) lives in
`app.optimize.workers.tasks`.

asyncio.run() is safe here because Celery workers are separate OS processes and
worker_prefetch_multiplier=1 ensures one task runs at a time per worker.
"""

import asyncio
from typing import Any

import structlog

from app.utils.log import get_logger
from app.workers.celery_app import celery_app

log = get_logger(__name__)


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
        from uuid import UUID

        from app.config.app import get_app_settings
        from app.core.logging import setup_worker_logging
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.repositories.health_score_repo import HealthScoreRepository
        from app.services.prompt_service import PromptService

        setup_worker_logging(debug=get_app_settings().DEBUG)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(user_id=user_id, task="score_prompt_async")
        reset_connection_pool()
        await dispose_async_engine()

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
            log.warning("score_prompt_async_failed", error=str(exc))
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        asyncio.run(_run())
    except Exception:  # noqa: S110
        pass  # Exhausted retries — silently discard, non-critical
