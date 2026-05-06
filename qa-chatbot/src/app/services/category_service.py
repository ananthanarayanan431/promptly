from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_category import PromptCategory
from app.repositories.prompt_category_repo import PromptCategoryRepository

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = _SLUG_RE.sub("-", name.lower()).strip("-")
    return s[:40] or "category"


class SlugConflictError(Exception):
    """Raised when a slug derived from name collides with an existing category."""


class CategoryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = PromptCategoryRepository(db)

    async def list_for_user(self, *, user_id: UUID) -> list[PromptCategory]:
        return await self.repo.list_visible_to_user(user_id=user_id)

    async def resolve(self, *, slug: str | None, user_id: UUID) -> PromptCategory | None:
        """Resolve the category for an optimization request. None if unknown slug."""
        if not slug:
            return None
        return await self.repo.get_by_slug_for_user(slug=slug, user_id=user_id)

    async def create_custom(self, *, user_id: UUID, name: str, description: str) -> PromptCategory:
        slug = _slugify(name)
        existing = await self.repo.get_by_slug_for_user(slug=slug, user_id=user_id)
        if existing is not None:
            raise SlugConflictError(slug)
        try:
            cat = await self.repo.create(
                user_id=user_id,
                slug=slug,
                name=name.strip(),
                description=description.strip(),
                is_predefined=False,
            )
        except IntegrityError as exc:
            # Concurrent insert won the race after our pre-check; surface as conflict.
            await self.db.rollback()
            raise SlugConflictError(slug) from exc
        return cat

    async def delete_custom(self, *, user_id: UUID, slug: str) -> bool:
        cat = await self.repo.get_user_owned_by_slug(slug=slug, user_id=user_id)
        if cat is None:
            return False
        await self.repo.delete(cat)
        return True
