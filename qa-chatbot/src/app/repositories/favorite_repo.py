from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import cast, func, select, update
from sqlalchemy.dialects.postgresql import TEXT
from sqlalchemy.orm import selectinload

from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.repositories.base import BaseRepository


class FavoriteRepository(BaseRepository[FavoritePrompt]):
    model = FavoritePrompt

    async def get_by_version(
        self, *, user_id: UUID, prompt_version_id: UUID
    ) -> FavoritePrompt | None:
        result = await self.db.execute(
            select(FavoritePrompt).where(
                FavoritePrompt.user_id == user_id,
                FavoritePrompt.prompt_version_id == prompt_version_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_for_user(self, *, favorite_id: UUID, user_id: UUID) -> FavoritePrompt | None:
        result = await self.db.execute(
            select(FavoritePrompt)
            .options(selectinload(FavoritePrompt.prompt_version))
            .where(FavoritePrompt.id == favorite_id, FavoritePrompt.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_for_user(
        self,
        *,
        user_id: UUID,
        q: str | None = None,
        category: str | None = None,
        tags: list[str] | None = None,
        sort: str = "recently_liked",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FavoritePrompt], int]:
        stmt = (
            select(FavoritePrompt)
            .options(selectinload(FavoritePrompt.prompt_version))
            .join(PromptVersion, FavoritePrompt.prompt_version_id == PromptVersion.id)
            .where(FavoritePrompt.user_id == user_id)
        )

        if category:
            stmt = stmt.where(FavoritePrompt.category == category)

        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                (PromptVersion.name.ilike(like))
                | (PromptVersion.content.ilike(like))
                | (FavoritePrompt.note.ilike(like))
            )

        if tags:
            for tag in tags:
                stmt = stmt.where(cast(FavoritePrompt.tags, TEXT).ilike(f'%"{tag}"%'))

        pinned_first = FavoritePrompt.is_pinned.desc()
        sort_map: dict[str, Any] = {
            "recently_liked": FavoritePrompt.liked_at.desc(),
            "recently_used": FavoritePrompt.last_used_at.desc().nullslast(),
            "most_used": FavoritePrompt.use_count.desc(),
            "name": PromptVersion.name.asc(),
        }
        order = sort_map.get(sort, FavoritePrompt.liked_at.desc())
        stmt = stmt.order_by(pinned_first, order)

        count_stmt = (
            select(func.count())
            .select_from(FavoritePrompt)
            .where(FavoritePrompt.user_id == user_id)
        )
        total = (await self.db.execute(count_stmt)).scalar_one()

        stmt = stmt.limit(limit).offset(offset)
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows), int(total)

    async def distinct_tags(self, *, user_id: UUID) -> list[str]:
        stmt = select(FavoritePrompt.tags).where(FavoritePrompt.user_id == user_id)
        rows = (await self.db.execute(stmt)).scalars().all()
        seen: set[str] = set()
        for tag_list in rows:
            if isinstance(tag_list, list):
                for t in tag_list:
                    if isinstance(t, str):
                        seen.add(t)
        return sorted(seen)

    async def increment_use(self, *, favorite_id: UUID, user_id: UUID) -> None:
        await self.db.execute(
            update(FavoritePrompt)
            .where(
                FavoritePrompt.id == favorite_id,
                FavoritePrompt.user_id == user_id,
            )
            .values(
                use_count=FavoritePrompt.use_count + 1,
                last_used_at=datetime.now(UTC),
            )
        )
        await self.db.flush()

    async def update_fields(self, instance: FavoritePrompt, **fields: Any) -> FavoritePrompt:
        return await self.update(instance, **fields)
