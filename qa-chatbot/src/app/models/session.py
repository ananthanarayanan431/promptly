import uuid
from .base import Base
from .base import TimestampMixin
from .base import UUIDMixin
from sqlalchemy import Text
from sqlalchemy import String
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship


class ChatSession(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "chat_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str | None] = mapped_column(String(255))
    graph_thread_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)

    user: Mapped["User"] = relationship(back_populates="sessions")
    messages: Mapped[list["Message"]] = relationship(back_populates="session")