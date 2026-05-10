from __future__ import annotations

import json
from typing import Any

from app.config.redis import get_redis_settings
from app.db.redis import get_redis_client

_redis_settings = get_redis_settings()
_JOB_PREFIX = "domain_prompt:job:"
_TOURNAMENT_PREFIX = "domain_prompt:tournament:"


def _job_key(job_id: str) -> str:
    return f"{_JOB_PREFIX}{job_id}"


async def set_dp_job_status(job_id: str, status: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:status",
        status,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:status")
    return result


async def set_dp_job_owner(job_id: str, user_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:owner",
        user_id,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_owner(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:owner")
    return result


async def set_dp_job_result(job_id: str, result: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:result",
        json.dumps(result),
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_result(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_job_key(job_id)}:result")
    if raw is None:
        return None
    return dict(json.loads(raw))


async def set_dp_tournament_state(domain_id: str, state: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_TOURNAMENT_PREFIX}{domain_id}",
        json.dumps(state),
        ex=3600,  # 1-hour TTL — tournament state is ephemeral
    )


async def get_dp_tournament_state(domain_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_TOURNAMENT_PREFIX}{domain_id}")
    if raw is None:
        return None
    return dict(json.loads(raw))
