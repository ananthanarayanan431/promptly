from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    DatabaseHealth,
    QueueHealth,
    RedisHealth,
    SystemHealth,
    WorkerHealth,
)
from promptly.db.redis import get_redis_client

log = structlog.get_logger()


async def check_system_health(db: AsyncSession) -> SystemHealth:
    """Live health snapshot of all platform components."""
    from promptly.workers.celery_app import celery_app  # local to avoid circular import

    redis = await get_redis_client()

    try:
        info: dict[str, Any] = await redis.info()
        total_keys: int = await redis.dbsize()
        redis_health = RedisHealth(
            status="ok",
            used_memory_human=str(info.get("used_memory_human", "?")),
            connected_clients=int(info.get("connected_clients", 0)),
            total_keys=total_keys,
        )
    except Exception:
        redis_health = RedisHealth(
            status="error", used_memory_human="?", connected_clients=0, total_keys=0
        )

    try:
        t0 = time.perf_counter()
        await db.execute(text("SELECT 1"))
        elapsed_ms = (time.perf_counter() - t0) * 1000
        db_health = DatabaseHealth(status="ok", response_time_ms=round(elapsed_ms, 2))
    except Exception:
        db_health = DatabaseHealth(status="error", response_time_ms=0.0)

    try:

        def _inspect_workers() -> dict[str, list[Any]] | None:
            raw = celery_app.control.inspect(timeout=2.0).active()
            if raw is None:
                return None
            return {k: list(v) for k, v in raw.items()}

        active: dict[str, list[Any]] | None = await asyncio.to_thread(_inspect_workers)
        if not active:
            worker_health = WorkerHealth(status="error", active_count=0, worker_names=[])
        else:
            worker_names = list(active.keys())
            active_count = sum(len(tasks) for tasks in active.values())
            worker_health = WorkerHealth(
                status="ok" if worker_names else "degraded",
                active_count=active_count,
                worker_names=worker_names,
            )
    except Exception:
        worker_health = WorkerHealth(status="error", active_count=0, worker_names=[])

    pending_chat = active_chat = pending_domain = active_domain = 0
    try:
        async for key in redis.scan_iter("chat:job:*:status", count=200):
            val: str | None = await redis.get(key)
            if val == "queued":
                pending_chat += 1
            elif val == "started":
                active_chat += 1
        async for key in redis.scan_iter("domain_prompt:job:*:status", count=200):
            val = await redis.get(key)
            if val == "queued":
                pending_domain += 1
            elif val == "started":
                active_domain += 1
    except Exception as exc:
        log.warning("queue_health_scan_failed", error=str(exc))

    return SystemHealth(
        redis=redis_health,
        database=db_health,
        workers=worker_health,
        queue=QueueHealth(
            pending_chat=pending_chat,
            active_chat=active_chat,
            pending_domain=pending_domain,
            active_domain=active_domain,
        ),
        checked_at=datetime.now(UTC).isoformat(),
    )
