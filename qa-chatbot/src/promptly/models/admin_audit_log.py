from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class AdminAuditLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "admin_audit_log"

    admin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    details: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
