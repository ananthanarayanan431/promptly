from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from promptly.models.usage_event import UsageEvent
from promptly.repositories.base import BaseRepository

# Known actions — guards against typos/garbage being logged.
# Credit costs are NOT enforced here: balance checks live at the API boundary.
_VALID_ACTIONS: frozenset[str] = frozenset(
    {"optimize", "health_score", "advisory", "domain_pdo", "bridge"}
)


class UsageEventRepository(BaseRepository[UsageEvent]):
    model = UsageEvent

    async def log(
        self,
        *,
        user_id: UUID,
        action: str,
        credits_spent: int,
        job_id: str | None = None,
    ) -> UsageEvent | None:
        """
        Append a usage event row. Caller controls the transaction.

        When ``job_id`` is supplied, the write is idempotent — if an event already
        exists for the same ``(action, job_id)`` pair, returns ``None`` instead of
        inserting a duplicate. This protects against Celery retries double-counting.
        """
        if action not in _VALID_ACTIONS:
            raise ValueError(
                f"Unknown usage action {action!r}; expected one of {sorted(_VALID_ACTIONS)}"
            )

        if job_id is not None:
            existing = await self.db.execute(
                select(UsageEvent.id).where(
                    UsageEvent.action == action,
                    UsageEvent.job_id == job_id,
                )
            )
            if existing.scalar_one_or_none() is not None:
                return None

        try:
            return await self.create(
                user_id=user_id,
                action=action,
                credits_spent=credits_spent,
                job_id=job_id,
            )
        except IntegrityError:
            await self.db.rollback()
            return None

    async def aggregate_for_user(
        self, *, user_id: UUID, since: datetime | None = None
    ) -> dict[str, dict[str, int]]:
        """
        Return per-action counts and credits since the given timestamp (or all time
        when `since` is None). Result keys are action slugs; each value is
        {"calls": N, "credits": M}. Missing actions are not included.
        """
        stmt = select(
            UsageEvent.action,
            func.count().label("calls"),
            func.coalesce(func.sum(UsageEvent.credits_spent), 0).label("credits"),
        ).where(UsageEvent.user_id == user_id)
        if since is not None:
            stmt = stmt.where(UsageEvent.created_at >= since)
        stmt = stmt.group_by(UsageEvent.action)

        rows = (await self.db.execute(stmt)).all()
        return {row.action: {"calls": int(row.calls), "credits": int(row.credits)} for row in rows}


def month_start_utc() -> datetime:
    """First instant of the current calendar month in UTC."""
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
