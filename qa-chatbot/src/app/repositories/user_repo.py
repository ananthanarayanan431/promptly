from uuid import UUID

from sqlalchemy import select, update

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

    async def deduct_credits(self, user_id: UUID, amount: int) -> bool:
        """Atomically deduct credits, returning False if balance is insufficient.

        Uses a single UPDATE … WHERE credits >= amount so concurrent requests
        cannot both pass the balance check and overdraft the account.
        """
        result = await self.db.execute(
            update(User)
            .where(User.id == user_id, User.credits >= amount)
            .values(credits=User.credits - amount)
            .returning(User.id)
        )
        return result.scalar_one_or_none() is not None

    async def refund_credits(self, user_id: UUID, amount: int) -> None:
        """Add credits back to a user account (used after a failed job)."""
        await self.db.execute(
            update(User).where(User.id == user_id).values(credits=User.credits + amount)
        )
