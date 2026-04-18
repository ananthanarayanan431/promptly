import hashlib
import json
from typing import Any

from app.config.redis import get_redis_settings
from app.db.redis import get_redis_client

redis_settings = get_redis_settings()

CACHE_PREFIX = "chat:response:"
JOB_PREFIX = "chat:job:"


def _cache_key(prompt: str) -> str:
    digest = hashlib.sha256(prompt.strip().lower().encode()).hexdigest()
    return f"{CACHE_PREFIX}{digest}"


def _job_key(job_id: str) -> str:
    return f"{JOB_PREFIX}{job_id}"


# ---------------------------------------------------------------------------
# Response cache (avoid re-running identical prompts through the full pipeline)
# ---------------------------------------------------------------------------


async def get_cached_response(prompt: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw = await redis.get(_cache_key(prompt))
    result: dict[str, Any] | None = json.loads(raw) if raw else None
    return result


async def set_cached_response(prompt: str, data: dict[str, Any], ttl: int | None = None) -> None:
    redis = await get_redis_client()
    await redis.set(
        _cache_key(prompt),
        json.dumps(data),
        ex=ttl or redis_settings.REDIS_TTL_SECONDS,
    )


# ---------------------------------------------------------------------------
# Async job tracking (Celery task lifecycle in Redis)
# ---------------------------------------------------------------------------


async def get_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:status")
    return result


async def set_job_status(job_id: str, status: str, ttl: int | None = None) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:status",
        status,
        ex=ttl or redis_settings.REDIS_TTL_SECONDS,
    )


async def get_job_result(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis_client()
    raw = await redis.get(_job_key(job_id))
    result: dict[str, Any] | None = json.loads(raw) if raw else None
    return result


async def set_job_result(job_id: str, data: dict[str, Any], ttl: int | None = None) -> None:
    redis = await get_redis_client()
    await redis.set(
        _job_key(job_id),
        json.dumps(data),
        ex=ttl or redis_settings.REDIS_TTL_SECONDS,
    )
