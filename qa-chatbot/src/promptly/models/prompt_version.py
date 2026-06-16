from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class PromptVersion(Base, UUIDMixin, TimestampMixin):
    """
    Stores named, versioned prompts.

    All versions of a prompt share the same `prompt_id` (a stable UUID generated
    when the prompt family is first created). `version` starts at 1 and increments
    each time the user runs an optimization cycle on that prompt.

    Flow:
        POST /prompts/versions          → version=1, new prompt_id
        POST /prompts/versions/{id}/optimize → version=2  (optimized from v1)
        POST /prompts/versions/{id}/optimize → version=3  (optimized from v2)
    """

    __tablename__ = "prompt_versions"

    # Groups all versions of the same named prompt together
    prompt_id: Mapped[uuid.UUID] = mapped_column(index=True)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)

    # Human-readable name the user assigned (e.g. "my-email-draft")
    name: Mapped[str] = mapped_column(String(255))

    # 1-based sequential version number within the prompt family
    version: Mapped[int] = mapped_column(Integer)

    # The actual prompt text at this version
    content: Mapped[str] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="prompt_versions")
