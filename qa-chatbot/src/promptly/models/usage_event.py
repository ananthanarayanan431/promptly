from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class UsageEvent(Base, UUIDMixin):
    __tablename__ = "usage_events"
    __table_args__ = (
        # Dedupe Celery retries: same job can't log the same action twice.
        # Rows without a job_id (health_score / advisory) are not deduped.
        UniqueConstraint("action", "job_id", name="uq_usage_events_action_job"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # "optimize" | "health_score" | "advisory"
    action: Mapped[str] = mapped_column(String(20), index=True)
    credits_spent: Mapped[int] = mapped_column(Integer)
    # Set for actions that originate from a Celery job (currently "optimize").
    # Used as an idempotency key together with `action` so retries don't double-log.
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
