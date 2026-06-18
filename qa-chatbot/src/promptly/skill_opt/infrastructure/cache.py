from __future__ import annotations

import json
from typing import Any

from promptly.config.redis import get_redis_settings
from promptly.db.redis import get_redis_client

_redis_settings = get_redis_settings()
_JOB_PREFIX = "skill_opt:job:"
_STATE_PREFIX = "skill_opt:state:"

_TTL = _redis_settings.REDIS_TTL_SECONDS


def _job_key(job_id: str) -> str:
    return f"{_JOB_PREFIX}{job_id}"


def _state_key(project_id: str) -> str:
    return f"{_STATE_PREFIX}{project_id}"


# ── Job lifecycle ─────────────────────────────────────────────────────────────


async def set_so_job_status(job_id: str, status: str) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:status", status, ex=_TTL)


async def get_so_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    val: str | None = await redis.get(f"{_job_key(job_id)}:status")
    return val


async def set_so_job_owner(job_id: str, user_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:owner", user_id)  # no TTL — ownership is permanent


async def get_so_job_owner(job_id: str) -> str | None:
    redis = await get_redis_client()
    val2: str | None = await redis.get(f"{_job_key(job_id)}:owner")
    return val2


async def set_so_job_project_id(job_id: str, project_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:project_id", project_id)  # no TTL — ownership is permanent


async def get_so_job_project_id(job_id: str) -> str | None:
    redis = await get_redis_client()
    val3: str | None = await redis.get(f"{_job_key(job_id)}:project_id")
    return val3


async def set_so_job_result(job_id: str, result: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:result", json.dumps(result), ex=_TTL)


async def get_so_job_result(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_job_key(job_id)}:result")
    return json.loads(raw) if raw else None


async def set_so_job_cancel(job_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:cancel", "1", ex=_TTL)


async def is_so_job_cancelled(job_id: str) -> bool:
    redis = await get_redis_client()
    return bool(await redis.get(f"{_job_key(job_id)}:cancel"))


# ── Live optimization state ───────────────────────────────────────────────────


async def set_so_live_state(project_id: str, state: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(_state_key(project_id), json.dumps(state), ex=_TTL)


async def get_so_live_state(project_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(_state_key(project_id))
    return json.loads(raw) if raw else None


async def clear_so_live_state(project_id: str) -> None:
    redis = await get_redis_client()
    await redis.delete(_state_key(project_id))
