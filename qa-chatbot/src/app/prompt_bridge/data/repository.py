from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.prompt_bridge.data.models import (
    PromptMapping,
    PromptPair,
    TransferJob,
    TransferJobStatus,
)
from app.repositories.base import BaseRepository


class TransferJobRepository(BaseRepository[TransferJob]):
    model = TransferJob

    async def get_by_id_and_user(self, job_id: uuid.UUID, user_id: uuid.UUID) -> TransferJob | None:
        result = await self.db.execute(
            select(TransferJob).where(TransferJob.id == job_id, TransferJob.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: uuid.UUID, *, limit: int = 50) -> list[TransferJob]:
        result = await self.db.execute(
            select(TransferJob)
            .where(TransferJob.user_id == user_id)
            .order_by(TransferJob.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def set_status(
        self,
        job: TransferJob,
        status: TransferJobStatus,
        **extra: Any,
    ) -> None:
        values: dict[str, Any] = {"status": status, **extra}
        await self.db.execute(update(TransferJob).where(TransferJob.id == job.id).values(**values))


class PromptMappingRepository(BaseRepository[PromptMapping]):
    model = PromptMapping

    async def get_by_id_and_user(
        self, mapping_id: uuid.UUID, user_id: uuid.UUID
    ) -> PromptMapping | None:
        result = await self.db.execute(
            select(PromptMapping)
            .where(PromptMapping.id == mapping_id, PromptMapping.user_id == user_id)
            .options(selectinload(PromptMapping.pairs))
        )
        return result.scalar_one_or_none()

    async def find_by_model_pair(
        self, user_id: uuid.UUID, source_model: str, target_model: str
    ) -> PromptMapping | None:
        """Return the most recent mapping for this user/model-pair, if any."""
        result = await self.db.execute(
            select(PromptMapping)
            .where(
                PromptMapping.user_id == user_id,
                PromptMapping.source_model == source_model,
                PromptMapping.target_model == target_model,
            )
            .options(selectinload(PromptMapping.pairs))
            .order_by(PromptMapping.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: uuid.UUID) -> list[PromptMapping]:
        result = await self.db.execute(
            select(PromptMapping)
            .where(PromptMapping.user_id == user_id)
            .order_by(PromptMapping.created_at.desc())
        )
        return list(result.scalars().all())

    async def add_pair(
        self,
        mapping: PromptMapping,
        source_optimal: str,
        target_optimal: str,
        source_score: float | None = None,
        target_score: float | None = None,
    ) -> PromptPair:
        pair = PromptPair(
            mapping_id=mapping.id,
            source_optimal_prompt=source_optimal,
            target_optimal_prompt=target_optimal,
            source_score=source_score,
            target_score=target_score,
        )
        self.db.add(pair)
        await self.db.flush()
        await self.db.execute(
            update(PromptMapping)
            .where(PromptMapping.id == mapping.id)
            .values(pair_count=PromptMapping.pair_count + 1)
        )
        return pair

    async def update_mapping_text(
        self, mapping: PromptMapping, mapping_text: str, **extra: Any
    ) -> None:
        values: dict[str, Any] = {"mapping_text": mapping_text, **extra}
        await self.db.execute(
            update(PromptMapping).where(PromptMapping.id == mapping.id).values(**values)
        )

    async def delete_by_id_and_user(self, mapping_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        mapping = await self.get_by_id_and_user(mapping_id, user_id)
        if mapping is None:
            return False
        await self.db.delete(mapping)
        await self.db.flush()
        return True
