from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class UsageEvent(Base, UUIDMixin):
    __tablename__ = "usage_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # "optimize" | "health_score" | "advisory"
    action: Mapped[str] = mapped_column(String(20), index=True)
    credits_spent: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
