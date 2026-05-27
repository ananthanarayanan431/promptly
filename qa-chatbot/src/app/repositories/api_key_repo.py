import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import exists, func, select, update
from sqlalchemy.sql import Select

from app.models.api_key import ApiKey
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    def _status_filter(
        self, query: Select[Any], status: Literal["active", "revoked", "all"]
    ) -> Select[Any]:
        if status == "active":
            return query.where(ApiKey.is_active == True)  # noqa: E712
        if status == "revoked":
            return query.where(ApiKey.is_active == False)  # noqa: E712
        return query

    async def list_by_org(
        self,
        org_id: str,
        *,
        status: Literal["active", "revoked", "all"] = "all",
        limit: int = 20,
        offset: int = 0,
    ) -> list[ApiKey]:
        q = self._status_filter(select(ApiKey).where(ApiKey.org_id == org_id), status)
        q = q.order_by(ApiKey.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def count_by_org(
        self,
        org_id: str,
        *,
        status: Literal["active", "revoked", "all"] = "all",
    ) -> int:
        q = self._status_filter(
            select(func.count()).select_from(ApiKey).where(ApiKey.org_id == org_id),
            status,
        )
        result = await self.db.execute(q)
        return int(result.scalar_one())

    async def get_by_id_and_org(self, key_id: uuid.UUID, org_id: str) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.org_id == org_id)
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

    async def has_active_org_name(self, org_id: str, name: str) -> bool:
        result = await self.db.execute(
            select(
                exists().where(
                    ApiKey.org_id == org_id,
                    ApiKey.name == name,
                    ApiKey.is_active == True,  # noqa: E712
                )
            )
        )
        return bool(result.scalar())

    async def deactivate(self, key_id: uuid.UUID) -> None:
        """Soft-delete an API key by setting is_active=False and recording revoked_at."""
        await self.db.execute(
            update(ApiKey)
            .where(ApiKey.id == key_id)
            .values(is_active=False, revoked_at=datetime.now(UTC))
        )

    async def update_last_used(self, key_id: uuid.UUID) -> None:
        """Record the current timestamp as the last time this key was used."""
        await self.db.execute(
            update(ApiKey).where(ApiKey.id == key_id).values(last_used_at=datetime.now(UTC))
        )

    async def revoke(self, key: ApiKey) -> ApiKey:
        key.is_active = False
        key.revoked_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(key)
        return key
