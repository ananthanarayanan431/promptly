from sqlalchemy import select

from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_api_key_hash(self, api_key_hash: str) -> User | None:
        result = await self.db.execute(select(User).where(User.api_key_hash == api_key_hash))
        return result.scalar_one_or_none()

    async def get_active_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()
