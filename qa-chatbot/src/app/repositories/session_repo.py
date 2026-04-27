from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.session import ChatSession
from app.repositories.base import BaseRepository


class SessionRepository(BaseRepository[ChatSession]):
    model = ChatSession

    async def get_by_thread_id(self, thread_id: str) -> ChatSession | None:
        result = await self.db.execute(
            select(ChatSession).where(ChatSession.graph_thread_id == thread_id)
        )
        return result.scalar_one_or_none()

    async def get_by_user_id(
        self, user_id: UUID, *, limit: int = 20, offset: int = 0
    ) -> list[ChatSession]:
        result = await self.db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(ChatSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def get_with_messages(self, session_id: UUID) -> ChatSession | None:
        result = await self.db.execute(
            select(ChatSession)
            .where(ChatSession.id == session_id)
            .options(selectinload(ChatSession.messages))
        )
        return result.scalar_one_or_none()

    async def get_or_create(
        self,
        *,
        session_id: str,
        user_id: str | UUID,
        graph_thread_id: str,
        title: str | None = None,
    ) -> tuple[ChatSession, bool]:
        """
        Returns (session, created: bool).
        Idempotent — safe to call on every request.
        """
        existing = await self.get_by_thread_id(graph_thread_id)
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
        if existing:
            if existing.user_id == user_uuid:
                return existing, False
            # thread_id belongs to a different user — fall through and create a new session
        session = await self.create(
            id=UUID(session_id),
            user_id=user_uuid,
            graph_thread_id=graph_thread_id,
            title=title,
        )
        return session, True
