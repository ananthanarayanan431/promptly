import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models.api_key import ApiKey
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    async def list_by_user(self, user_id: uuid.UUID) -> list[ApiKey]:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.user_id == user_id).order_by(ApiKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id_and_user(self, key_id: uuid.UUID, user_id: uuid.UUID) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_active_by_hash(self, key_hash: str) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.key_hash == key_hash,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def has_active_name(self, user_id: uuid.UUID, name: str) -> bool:
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.user_id == user_id,
                ApiKey.name == name,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None

    async def revoke(self, key: ApiKey) -> ApiKey:
        key.is_active = False
        key.revoked_at = datetime.now(UTC)
        self.db.add(key)
        await self.db.flush()
        await self.db.refresh(key)
        return key
