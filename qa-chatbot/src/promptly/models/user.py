from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .api_key import ApiKey
    from .favorite_prompt import FavoritePrompt
    from .prompt_version import PromptVersion
    from .session import ChatSession


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    supabase_user_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    token_balance: Mapped[int] = mapped_column(
        BigInteger, default=3_000_000, server_default="3000000", nullable=False
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    data_sharing_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    sessions: Mapped[list[ChatSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    prompt_versions: Mapped[list[PromptVersion]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    favorite_prompts: Mapped[list[FavoritePrompt]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    api_keys: Mapped[list[ApiKey]] = relationship(
        back_populates="created_by_user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
