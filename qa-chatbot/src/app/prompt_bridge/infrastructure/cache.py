"""
Redis job lifecycle for PromptBridge.

Key schema (prefix: pb:job:<job_id>):
  pb:job:<id>:status   — queued | calibrating | extracting_mapping | adapting | completed | failed
  pb:job:<id>:owner    — user_id string (ownership check)
  pb:job:<id>:result   — JSON result payload on completion
  pb:job:<id>:progress — JSON progress info written during long-running tasks
"""

from __future__ import annotations

import json
from typing import Any

from app.config.redis import get_redis_settings
from app.db.redis import get_redis_client

_redis_settings = get_redis_settings()
_PREFIX = "pb:job:"


def _key(job_id: str) -> str:
    return f"{_PREFIX}{job_id}"


async def set_pb_job_status(job_id: str, status: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_key(job_id)}:status",
        status,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_pb_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_key(job_id)}:status")
    return result


async def set_pb_job_owner(job_id: str, user_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_key(job_id)}:owner",
        user_id,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_pb_job_owner(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_key(job_id)}:owner")
    return result


async def set_pb_job_result(job_id: str, result: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_key(job_id)}:result",
        json.dumps(result),
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_pb_job_result(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_key(job_id)}:result")
    if raw is None:
        return None
    return dict(json.loads(raw))


async def set_pb_job_progress(job_id: str, progress: dict[str, Any]) -> None:
    """Write live progress (stage, step, total_steps, best_score) during calibration."""
    redis = await get_redis_client()
    await redis.set(
        f"{_key(job_id)}:progress",
        json.dumps(progress),
        ex=3600,
    )


async def get_pb_job_progress(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_key(job_id)}:progress")
    if raw is None:
        return None
    return dict(json.loads(raw))
