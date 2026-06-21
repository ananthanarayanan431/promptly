"""
ORM models for PromptBridge.

  TransferJob        — one user-initiated transfer request (job lifecycle)
  PromptMapping      — reusable source→target transfer mapping + calibrated pairs
  PromptPair         — one calibrated (source_optimal, target_optimal) pair
                       associated with a mapping
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from promptly.models.base import Base, TimestampMixin, UUIDMixin


class TransferJobStatus(enum.StrEnum):
    queued = "queued"
    calibrating = "calibrating"
    extracting_mapping = "extracting_mapping"
    adapting = "adapting"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class TransferJob(Base, UUIDMixin, TimestampMixin):
    """
    Represents one transfer request: source_prompt → target_model.

    Lifecycle: queued → calibrating → extracting_mapping → adapting → completed | failed

    If a reusable mapping already exists for (source_model, target_model) the job
    skips straight to adapting, costing 1 credit instead of 5.
    """

    __tablename__ = "pb_transfer_jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    source_model: Mapped[str] = mapped_column(String(120), nullable=False)
    target_model: Mapped[str] = mapped_column(String(120), nullable=False)
    adapted_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TransferJobStatus] = mapped_column(
        Enum(TransferJobStatus, name="pb_transfer_job_status"),
        default=TransferJobStatus.queued,
        nullable=False,
    )
    mapping_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pb_prompt_mappings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reused_mapping: Mapped[bool] = mapped_column(default=False, nullable=False)
    credits_charged: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    redis_job_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    mapping: Mapped[PromptMapping | None] = relationship(
        "PromptMapping", back_populates="jobs", foreign_keys=[mapping_id], lazy="raise"
    )


class PromptMapping(Base, UUIDMixin, TimestampMixin):
    """
    A reusable transfer mapping for a (source_model, target_model) pair.

    Built from N calibrated prompt pairs. Stored so future transfers between
    the same model pair skip calibration (just run the adapter, 1 credit).
    """

    __tablename__ = "pb_prompt_mappings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_model: Mapped[str] = mapped_column(String(120), nullable=False)
    target_model: Mapped[str] = mapped_column(String(120), nullable=False)
    mapping_text: Mapped[str] = mapped_column(Text, nullable=False)
    pair_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_source_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_target_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    pairs: Mapped[list[PromptPair]] = relationship(
        back_populates="mapping", cascade="all, delete-orphan", lazy="raise"
    )
    jobs: Mapped[list[TransferJob]] = relationship(
        "TransferJob",
        back_populates="mapping",
        foreign_keys=[TransferJob.mapping_id],
        lazy="raise",
    )


class PromptPair(Base, UUIDMixin, TimestampMixin):
    """
    One calibrated (source_optimal, target_optimal) pair inside a PromptMapping.

    Accumulated across calls — each new transfer adds a fresh pair, improving
    the mapping quality progressively.
    """

    __tablename__ = "pb_prompt_pairs"

    mapping_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pb_prompt_mappings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_optimal_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    target_optimal_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    source_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    mapping: Mapped[PromptMapping] = relationship(back_populates="pairs", lazy="raise")
