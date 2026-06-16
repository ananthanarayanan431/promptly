from uuid import UUID

from sqlalchemy import select, update

from promptly.models.user import User
from promptly.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_supabase_id(self, supabase_user_id: str) -> User | None:
        """Fetch a user by their Supabase auth UUID."""
        result = await self.db.execute(
            select(User).where(User.supabase_user_id == supabase_user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_active_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def deduct_credits(self, user_id: UUID, amount: int) -> bool:
        """Atomically deduct credits, returning False if balance is insufficient."""
        result = await self.db.execute(
            update(User)
            .where(User.id == user_id, User.credits >= amount)
            .values(credits=User.credits - amount)
            .returning(User.id)
        )
        return result.scalar_one_or_none() is not None

    async def add_credits(self, user_id: UUID, amount: int) -> int | None:
        """Add credits to a user account, returning the new balance (None if not found)."""
        result = await self.db.execute(
            update(User)
            .where(User.id == user_id)
            .values(credits=User.credits + amount)
            .returning(User.credits)
        )
        return result.scalar_one_or_none()

    async def refund_credits(self, user_id: UUID, amount: int) -> None:
        """Add credits back to a user account (used after a failed job)."""
        await self.db.execute(
            update(User).where(User.id == user_id).values(credits=User.credits + amount)
        )
