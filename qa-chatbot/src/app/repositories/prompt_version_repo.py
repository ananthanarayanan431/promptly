import uuid
from uuid import UUID

from sqlalchemy import select, update

from app.models.prompt_version import PromptVersion
from app.repositories.base import BaseRepository


class PromptVersionRepository(BaseRepository[PromptVersion]):
    model = PromptVersion

    async def get_all_by_prompt_id(self, prompt_id: UUID, user_id: UUID) -> list[PromptVersion]:
        """Return all versions of a prompt in ascending version order."""
        result = await self.db.execute(
            select(PromptVersion)
            .where(
                PromptVersion.prompt_id == prompt_id,
                PromptVersion.user_id == user_id,
            )
            .order_by(PromptVersion.version.asc())
        )
        return list(result.scalars().all())

    async def get_latest_by_prompt_id(self, prompt_id: UUID, user_id: UUID) -> PromptVersion | None:
        """Return the highest-version record for a given prompt_id."""
        result = await self.db.execute(
            select(PromptVersion)
            .where(
                PromptVersion.prompt_id == prompt_id,
                PromptVersion.user_id == user_id,
            )
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_next_version_number(self, prompt_id: UUID) -> int:
        """Return the next version number (latest + 1) for a prompt family."""
        latest = await self.db.execute(
            select(PromptVersion.version)
            .where(PromptVersion.prompt_id == prompt_id)
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
        current = latest.scalar_one_or_none()
        return (current or 0) + 1

    async def get_latest_by_name(self, name: str, user_id: UUID) -> PromptVersion | None:
        """Return the highest-version record for a given (name, user_id) pair."""
        result = await self.db.execute(
            select(PromptVersion)
            .where(
                PromptVersion.name == name,
                PromptVersion.user_id == user_id,
            )
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_all_by_user_id(self, user_id: UUID) -> list[PromptVersion]:
        """Return all versions for a user, ordered by prompt_id then version ascending."""
        result = await self.db.execute(
            select(PromptVersion)
            .where(PromptVersion.user_id == user_id)
            .order_by(PromptVersion.prompt_id, PromptVersion.version.asc())
        )
        return list(result.scalars().all())

    async def get_by_version_number(
        self, prompt_id: UUID, version: int, user_id: UUID
    ) -> PromptVersion | None:
        """Return a specific version of a prompt by version number."""
        result = await self.db.execute(
            select(PromptVersion).where(
                PromptVersion.prompt_id == prompt_id,
                PromptVersion.version == version,
                PromptVersion.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_family_name(self, prompt_id: UUID, user_id: UUID, name: str) -> None:
        """Rename all versions in a family to the given name."""
        await self.db.execute(
            update(PromptVersion)
            .where(PromptVersion.prompt_id == prompt_id, PromptVersion.user_id == user_id)
            .values(name=name)
        )

    async def create_version(
        self,
        *,
        prompt_id: UUID,
        user_id: UUID,
        name: str,
        version: int,
        content: str,
    ) -> PromptVersion:
        return await self.create(
            id=uuid.uuid4(),
            prompt_id=prompt_id,
            user_id=user_id,
            name=name,
            version=version,
            content=content,
        )
