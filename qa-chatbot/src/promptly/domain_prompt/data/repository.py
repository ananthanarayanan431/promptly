from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from promptly.domain_prompt.data.models import (
    DomainDataset,
    DomainOptimizationRun,
    DomainPrompt,
    DomainPromptStatus,
)
from promptly.repositories.base import BaseRepository


class DomainPromptRepository(BaseRepository[DomainPrompt]):
    model = DomainPrompt

    async def get_by_id(self, id: uuid.UUID) -> DomainPrompt | None:
        result = await self.db.execute(
            select(DomainPrompt)
            .where(DomainPrompt.id == id)
            .options(selectinload(DomainPrompt.dataset))
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: uuid.UUID) -> list[DomainPrompt]:
        result = await self.db.execute(
            select(DomainPrompt)
            .where(DomainPrompt.user_id == user_id)
            .options(selectinload(DomainPrompt.dataset))
            .order_by(DomainPrompt.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id_and_user(
        self, domain_id: uuid.UUID, user_id: uuid.UUID
    ) -> DomainPrompt | None:
        result = await self.db.execute(
            select(DomainPrompt)
            .where(DomainPrompt.id == domain_id, DomainPrompt.user_id == user_id)
            .options(selectinload(DomainPrompt.dataset))
        )
        return result.scalar_one_or_none()

    async def set_status(
        self,
        domain: DomainPrompt,
        status: DomainPromptStatus,
        **extra: Any,
    ) -> None:
        values: dict[str, Any] = {"status": status, **extra}
        await self.db.execute(
            update(DomainPrompt).where(DomainPrompt.id == domain.id).values(**values)
        )

    async def save_dataset(
        self,
        domain_id: uuid.UUID,
        user_id: uuid.UUID,
        bucket: str,
        pdf_key: str,
        dataset_key: str | None = None,
        row_count: int | None = None,
    ) -> DomainDataset:
        ds = DomainDataset(
            domain_id=domain_id,
            user_id=user_id,
            minio_bucket=bucket,
            pdf_key=pdf_key,
            dataset_key=dataset_key,
            row_count=row_count,
        )
        self.db.add(ds)
        await self.db.flush()
        return ds

    async def update_dataset(self, dataset: DomainDataset, **kwargs: Any) -> None:
        await self.db.execute(
            update(DomainDataset).where(DomainDataset.id == dataset.id).values(**kwargs)
        )


class DomainOptimizationRunRepository(BaseRepository[DomainOptimizationRun]):
    model = DomainOptimizationRun

    async def create_run(
        self,
        *,
        domain_id: uuid.UUID,
        domain_name: str,
        prompt_input: str,
        optimized_prompt: str | None = None,
        score_before: float | None = None,
        score_after: float | None = None,
        win_rate: float | None = None,
        candidates_tried: int | None = None,
        rounds_run: int | None = None,
        dataset_size: int | None = None,
        status: str = "completed",
        error_message: str | None = None,
    ) -> DomainOptimizationRun:
        run = DomainOptimizationRun(
            domain_id=domain_id,
            domain_name=domain_name,
            prompt_input=prompt_input,
            optimized_prompt=optimized_prompt,
            score_before=score_before,
            score_after=score_after,
            win_rate=win_rate,
            candidates_tried=candidates_tried,
            rounds_run=rounds_run,
            dataset_size=dataset_size,
            status=status,
            error_message=error_message,
        )
        self.db.add(run)
        await self.db.flush()
        return run

    async def get_runs_by_domain(
        self, domain_id: uuid.UUID, *, limit: int = 50
    ) -> list[DomainOptimizationRun]:
        result = await self.db.execute(
            select(DomainOptimizationRun)
            .where(DomainOptimizationRun.domain_id == domain_id)
            .order_by(DomainOptimizationRun.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
