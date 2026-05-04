from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class PromptCategory(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "prompt_categories"
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_prompt_category_user_slug"),)

    # NULL user_id = global predefined category; non-NULL = owned by that user.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    slug: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text)
    is_predefined: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    def __init__(self, **kw: Any) -> None:
        if "is_predefined" not in kw:
            kw["is_predefined"] = False
        super().__init__(**kw)
