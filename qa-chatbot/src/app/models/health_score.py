from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class HealthScore(Base, UUIDMixin, TimestampMixin):
    """
    Silently-computed quality scores for optimized prompts.
    Written in background after each optimization — no credits charged.
    Used to power the quality trend chart on the dashboard.
    """

    __tablename__ = "health_scores"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    overall_score: Mapped[float] = mapped_column(Float)
    prompt_text: Mapped[str] = mapped_column(Text)
