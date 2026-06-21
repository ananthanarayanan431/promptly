from uuid import UUID

from sqlalchemy import func, select, update

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

    # ── Token-balance methods ──────────────────────────────────────────────────

    # A running job is never stopped mid-execution even when tokens run out.
    # We only block *starting* a new job once the account is below this floor.
    _TOKEN_OVERDRAFT_LIMIT: int = -15_000

    async def has_min_tokens(self, user_id: UUID) -> bool:
        """Return True if the user can start a new job.

        We allow a gentle overdraft down to -15 000 so an in-progress run can
        complete even when the balance hits zero mid-execution.  New jobs are
        blocked once the overdraft limit is reached.
        """
        result = await self.db.execute(
            select(User.token_balance).where(
                User.id == user_id,
                User.token_balance > self._TOKEN_OVERDRAFT_LIMIT,
            )
        )
        return result.scalar_one_or_none() is not None

    async def deduct_tokens(self, user_id: UUID, amount: int) -> None:
        """Subtract actual tokens used after a job completes.

        No minimum guard — we allow mild overdraft so that a job that used
        slightly more than the user's remaining balance is still accounted for.
        """
        await self.db.execute(
            update(User).where(User.id == user_id).values(token_balance=User.token_balance - amount)
        )

    async def add_tokens(self, user_id: UUID, amount: int) -> None:
        """Add tokens to a user account (grants, refunds, top-ups)."""
        await self.db.execute(
            update(User).where(User.id == user_id).values(token_balance=User.token_balance + amount)
        )

    async def get_all_paginated(self, page: int, per_page: int) -> tuple[list[User], int]:
        """Return a page of users and the total count."""
        total_result = await self.db.execute(select(func.count()).select_from(User))
        total: int = total_result.scalar_one()

        result = await self.db.execute(
            select(User)
            .order_by(User.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        users = list(result.scalars().all())
        return users, total

    async def update_admin_fields(
        self,
        user_id: UUID,
        *,
        is_active: bool | None = None,
        is_admin: bool | None = None,
        credits_delta: int | None = None,
    ) -> User | None:
        """Patch admin-controllable fields. Returns None if user not found."""
        values: dict[str, object] = {}
        if is_active is not None:
            values["is_active"] = is_active
        if is_admin is not None:
            values["is_admin"] = is_admin
        if not values and credits_delta is None:
            return await self.get_by_id(user_id)

        if values:
            await self.db.execute(update(User).where(User.id == user_id).values(**values))

        if credits_delta is not None:
            await self.db.execute(
                update(User).where(User.id == user_id).values(credits=User.credits + credits_delta)
            )

        await self.db.flush()
        return await self.get_by_id(user_id)
