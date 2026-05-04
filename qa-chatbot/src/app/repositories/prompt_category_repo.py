from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select

from app.models.prompt_category import PromptCategory
from app.repositories.base import BaseRepository


class PromptCategoryRepository(BaseRepository[PromptCategory]):
    model = PromptCategory

    async def list_visible_to_user(self, *, user_id: UUID) -> list[PromptCategory]:
        """Return predefined categories + the user's own custom categories."""
        result = await self.db.execute(
            select(PromptCategory).where(
                or_(
                    PromptCategory.user_id.is_(None),
                    PromptCategory.user_id == user_id,
                )
            )
        )
        return list(result.scalars().all())

    async def get_by_slug_for_user(self, *, slug: str, user_id: UUID) -> PromptCategory | None:
        """Find a category by slug visible to this user (predefined OR user-owned)."""
        result = await self.db.execute(
            select(PromptCategory).where(
                PromptCategory.slug == slug,
                or_(
                    PromptCategory.user_id.is_(None),
                    PromptCategory.user_id == user_id,
                ),
            )
        )
        return result.scalar_one_or_none()

    async def get_user_owned_by_slug(self, *, slug: str, user_id: UUID) -> PromptCategory | None:
        result = await self.db.execute(
            select(PromptCategory).where(
                PromptCategory.slug == slug,
                PromptCategory.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()
