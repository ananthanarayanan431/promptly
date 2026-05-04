from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select

from app.models.usage_event import UsageEvent
from app.repositories.base import BaseRepository


class UsageEventRepository(BaseRepository[UsageEvent]):
    model = UsageEvent

    async def log(self, *, user_id: UUID, action: str, credits_spent: int) -> UsageEvent:
        """Append a usage event row. Caller controls the transaction."""
        return await self.create(
            user_id=user_id,
            action=action,
            credits_spent=credits_spent,
        )

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
