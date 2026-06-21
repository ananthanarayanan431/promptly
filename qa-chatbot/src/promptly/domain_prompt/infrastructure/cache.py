from __future__ import annotations

import json
from typing import Any

from promptly.config.redis import get_redis_settings
from promptly.db.redis import get_redis_client

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


async def clear_dp_tournament_state(domain_id: str) -> None:
    redis = await get_redis_client()
    await redis.delete(f"{_TOURNAMENT_PREFIX}{domain_id}")


# ── Dataset-preparation stage tracking ───────────────────────────────────────


async def set_dp_job_stage(job_id: str, stage: str) -> None:
    """Write current sub-stage of prepare_domain_dataset for UI progress tracking."""
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:stage",
        stage,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_stage(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:stage")
    return result


# ── Cancel / Celery / Active-job helpers ──────────────────────────────────────

_DOMAIN_ACTIVE_JOB_PREFIX = "domain_prompt:domain:"


async def set_dp_job_cancel(job_id: str) -> None:
    """Signal the worker to stop at the next inter-stage checkpoint."""
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:cancel", "1", ex=3600)


async def is_dp_job_cancelled(job_id: str) -> bool:
    redis = await get_redis_client()
    val: str | None = await redis.get(f"{_job_key(job_id)}:cancel")
    return val == "1"


async def set_dp_celery_task_id(job_id: str, celery_task_id: str) -> None:
    """Store the Celery task ID so cancel can revoke it from the broker queue."""
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:celery_task_id",
        celery_task_id,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_celery_task_id(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:celery_task_id")
    return result


async def set_dp_job_domain_id(job_id: str, domain_id: str) -> None:
    """Store domain_id on the job so cancel-by-job-id can look up the domain."""
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:domain_id",
        domain_id,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_domain_id(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:domain_id")
    return result


async def set_dp_domain_active_job(domain_id: str, job_id: str) -> None:
    """Map a domain to its currently running job_id (for cancel-by-domain-id)."""
    redis = await get_redis_client()
    await redis.set(
        f"{_DOMAIN_ACTIVE_JOB_PREFIX}{domain_id}:active_job_id",
        job_id,
        ex=3600,
    )


async def get_dp_domain_active_job(domain_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_DOMAIN_ACTIVE_JOB_PREFIX}{domain_id}:active_job_id")
    return result


async def clear_dp_domain_active_job(domain_id: str) -> None:
    redis = await get_redis_client()
    await redis.delete(f"{_DOMAIN_ACTIVE_JOB_PREFIX}{domain_id}:active_job_id")


# ── GEPA live state ───────────────────────────────────────────────────────────

_GEPA_PREFIX = "domain_prompt:gepa:"


async def set_dp_gepa_state(domain_id: str, state: dict[str, Any]) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_GEPA_PREFIX}{domain_id}",
        json.dumps(state),
        ex=3600,
    )


async def get_dp_gepa_state(domain_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_GEPA_PREFIX}{domain_id}")
    if raw is None:
        return None
    return dict(json.loads(raw))


async def clear_dp_gepa_state(domain_id: str) -> None:
    redis = await get_redis_client()
    await redis.delete(f"{_GEPA_PREFIX}{domain_id}")
