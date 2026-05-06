from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.domain_prompt.models import DomainDataset, DomainPrompt, DomainPromptStatus
from app.repositories.base import BaseRepository


class DomainPromptRepository(BaseRepository[DomainPrompt]):
    model = DomainPrompt

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
    ) -> DomainPrompt:
        return await self.update(domain, status=status, **extra)

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
        await self.db.refresh(ds)
        return ds

    async def update_dataset(self, dataset: DomainDataset, **kwargs: Any) -> DomainDataset:
        for k, v in kwargs.items():
            setattr(dataset, k, v)
        self.db.add(dataset)
        await self.db.flush()
        await self.db.refresh(dataset)
        return dataset
