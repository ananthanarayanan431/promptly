from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .prompt_version import PromptVersion
    from .user import User


class FavoritePrompt(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "favorite_prompts"
    __table_args__ = (
        UniqueConstraint("user_id", "prompt_version_id", name="uq_favorite_user_version"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    prompt_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prompt_versions.id", ondelete="CASCADE"), index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[Any]] = mapped_column(JSON, default=list, server_default="[]")
    category: Mapped[str] = mapped_column(String(20), default="Other", server_default="Other")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    def __init__(self, **kw: Any) -> None:
        # mapped_column(default=...) does not populate Python attributes until the ORM
        # flushes to the database; set eager defaults so pre-flush access is safe.
        if "tags" not in kw:
            kw["tags"] = []
        if "category" not in kw:
            kw["category"] = "Other"
        if "is_pinned" not in kw:
            kw["is_pinned"] = False
        if "use_count" not in kw:
            kw["use_count"] = 0
        super().__init__(**kw)

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    liked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="favorite_prompts")
    prompt_version: Mapped[PromptVersion] = relationship()
