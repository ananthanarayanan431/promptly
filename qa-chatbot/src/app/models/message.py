from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .session import ChatSession


class Message(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "messages"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    raw_prompt: Mapped[str | None] = mapped_column(Text)  # original user input
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)  # user feedback comment
    enhanced_prompt: Mapped[str | None] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)
    council_votes: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    model_used: Mapped[str | None] = mapped_column(String(100))
    token_usage: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    prompt_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("prompt_versions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    prompt_family_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    category_slug: Mapped[str | None] = mapped_column(String(40), nullable=True)

    session: Mapped[ChatSession] = relationship(back_populates="messages")
