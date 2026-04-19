from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class Template(Base, UUIDMixin, TimestampMixin):
    """
    Global read-only prompt templates curated by Promptly.
    Users pick a template to pre-fill their optimize input.
    No user ownership — templates are shared across all accounts.
    """

    __tablename__ = "templates"

    category: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(512))
    content: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
