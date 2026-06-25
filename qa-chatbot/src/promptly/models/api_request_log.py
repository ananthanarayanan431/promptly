from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class ApiRequestLog(Base, UUIDMixin):
    __tablename__ = "api_request_logs"

    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        nullable=False,
        index=True,
    )
