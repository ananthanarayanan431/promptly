import uuid
from .base import Base
from .base import TimestampMixin
from .base import UUIDMixin
from sqlalchemy import Text
from sqlalchemy import JSON
from sqlalchemy import String
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship


class Message(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "messages"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))          # user | assistant
    raw_prompt: Mapped[str | None] = mapped_column(Text)   # original user input
    enhanced_prompt: Mapped[str | None] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)
    council_votes: Mapped[dict | None] = mapped_column(JSON)
    model_used: Mapped[str | None] = mapped_column(String(100))
    token_usage: Mapped[dict | None] = mapped_column(JSON)

    session: Mapped["ChatSession"] = relationship(back_populates="messages")