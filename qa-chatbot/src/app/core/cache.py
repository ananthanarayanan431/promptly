import hashlib
import json

from app.config import get_settings
from app.db.redis import get_redis_client

settings = get_settings()

CACHE_PREFIX = "chat:response:"
JOB_PREFIX = "chat:job:"


def _cache_key(enhanced_prompt: str) -> str:
    digest = hashlib.sha256(enhanced_prompt.strip().lower().encode()).hexdigest()
    return f"{CACHE_PREFIX}{digest}"


def _job_key(job_id: str) -> str:
    return f"{JOB_PREFIX}{job_id}"


async def get_cached_response(enhanced_prompt: str) -> dict | None:
    redis = await get_redis_client()
    raw = await redis.get(_cache_key(enhanced_prompt))
    return json.loads(raw) if raw else None


async def set_cached_response(enhanced_prompt: str, data: dict, ttl: int | None = None) -> None:
    redis = await get_redis_client()
    await redis.set(
        _cache_key(enhanced_prompt),
        json.dumps(data),
        ex=ttl or settings.redis_ttl_seconds,
    )


async def get_job_result(job_id: str) -> dict | None:
    redis = await get_redis_client()
    raw = await redis.get(_job_key(job_id))
    return json.loads(raw) if raw else None


async def set_job_result(job_id: str, data: dict, ttl: int = 3600) -> None:
    redis = await get_redis_client()
    await redis.set(_job_key(job_id), json.dumps(data), ex=ttl)


async def set_job_status(job_id: str, status: str, ttl: int = 3600) -> None:
    redis = await get_redis_client()
    await redis.set(f"{_job_key(job_id)}:status", status, ex=ttl)


async def get_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    return await redis.get(f"{_job_key(job_id)}:status")
