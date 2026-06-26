from __future__ import annotations

from promptly.admin.api.schemas import JobEntry, JobsMonitor, JobsSummary
from promptly.core.cache import get_job_owner
from promptly.db.redis import get_redis_client
from promptly.domain_prompt.infrastructure.cache import get_dp_job_owner


async def fetch_jobs_monitor() -> JobsMonitor:
    """Scan active/recent jobs from Redis."""
    redis = await get_redis_client()
    jobs: list[JobEntry] = []

    async for key in redis.scan_iter("chat:job:*:status", count=200):
        parts = key.split(":")
        if len(parts) < 4:  # noqa: PLR2004
            continue
        job_id = parts[2]
        status: str | None = await redis.get(key)
        if status is None:
            continue
        try:
            user_id = await get_job_owner(job_id)
        except Exception:
            user_id = None
        jobs.append(JobEntry(job_id=job_id, type="chat", status=status, user_id=user_id))

    async for key in redis.scan_iter("domain_prompt:job:*:status", count=200):
        parts = key.split(":")
        if len(parts) < 4:  # noqa: PLR2004
            continue
        job_id = parts[2]
        status = await redis.get(key)
        if status is None:
            continue
        try:
            user_id = await get_dp_job_owner(job_id)
        except Exception:
            user_id = None
        jobs.append(JobEntry(job_id=job_id, type="domain", status=status, user_id=user_id))

    jobs = jobs[:100]
    summary = JobsSummary(
        queued=sum(1 for j in jobs if j.status == "queued"),
        running=sum(1 for j in jobs if j.status == "started"),
        completed=sum(1 for j in jobs if j.status == "completed"),
        failed=sum(1 for j in jobs if j.status == "failed"),
    )
    return JobsMonitor(jobs=jobs, summary=summary)
