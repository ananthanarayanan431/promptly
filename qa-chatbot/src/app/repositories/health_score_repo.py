from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from datetime import date as date_type

from sqlalchemy import Date, cast, func, select

from app.models.health_score import HealthScore
from app.repositories.base import BaseRepository


class HealthScoreRepository(BaseRepository[HealthScore]):
    model = HealthScore

    async def save_score(
        self,
        *,
        user_id: uuid.UUID,
        overall_score: float,
        prompt_text: str,
    ) -> HealthScore:
        return await self.create(
            user_id=user_id,
            overall_score=overall_score,
            prompt_text=prompt_text,
        )

    async def get_daily_averages(
        self, user_id: uuid.UUID, *, days: int = 30
    ) -> list[tuple[date_type, float]]:
        since = datetime.now(UTC) - timedelta(days=days)
        stmt = (
            select(
                cast(HealthScore.created_at, Date).label("day"),
                func.avg(HealthScore.overall_score).label("avg_score"),
            )
            .where(
                HealthScore.user_id == user_id,
                HealthScore.created_at >= since,
            )
            .group_by(cast(HealthScore.created_at, Date))
            .order_by(cast(HealthScore.created_at, Date))
        )
        rows = (await self.db.execute(stmt)).all()
        return [(row.day, float(row.avg_score)) for row in rows]
