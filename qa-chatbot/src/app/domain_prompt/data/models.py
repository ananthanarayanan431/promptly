from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class DomainPromptStatus(enum.StrEnum):
    pending = "pending"
    preparing_dataset = "preparing_dataset"
    optimizing = "optimizing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class DomainPrompt(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "domain_prompts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    optimized_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[DomainPromptStatus] = mapped_column(
        Enum(DomainPromptStatus, name="domain_prompt_status"),
        default=DomainPromptStatus.pending,
        nullable=False,
    )
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    win_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidates_tried: Mapped[int | None] = mapped_column(Integer, nullable=True)
    credits_charged: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    dataset: Mapped[DomainDataset | None] = relationship(
        back_populates="domain", cascade="all, delete-orphan", uselist=False, lazy="raise"
    )
    runs: Mapped[list[DomainOptimizationRun]] = relationship(
        back_populates="domain", cascade="all, delete-orphan", lazy="raise"
    )


class DomainDataset(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "domain_datasets"

    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domain_prompts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    minio_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    pdf_key: Mapped[str] = mapped_column(String(500), nullable=False)
    dataset_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    domain: Mapped[DomainPrompt] = relationship(back_populates="dataset", lazy="raise")


class DomainOptimizationRun(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "domain_optimization_runs"

    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domain_prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    domain_name: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_input: Mapped[str] = mapped_column(Text, nullable=False)
    optimized_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    win_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    candidates_tried: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rounds_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dataset_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    domain: Mapped[DomainPrompt] = relationship(back_populates="runs", lazy="raise")
