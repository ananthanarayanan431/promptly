from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from promptly.models.base import Base, TimestampMixin, UUIDMixin


class SkillOptStatus(enum.StrEnum):
    pending = "pending"
    optimizing = "optimizing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class SkillOptProject(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "skill_opt_projects"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_description: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[SkillOptStatus] = mapped_column(
        Enum(SkillOptStatus, name="skill_opt_status"),
        default=SkillOptStatus.pending,
        nullable=False,
    )

    # Skill documents (markdown)
    seed_skill: Mapped[str | None] = mapped_column(Text, nullable=True)
    best_skill: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Scores (0–1 scale)
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)

    score_test: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Run stats
    epochs_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edits_accepted: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edits_rejected: Mapped[int | None] = mapped_column(Integer, nullable=True)
    example_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    credits_charged: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    runs: Mapped[list[SkillOptRun]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="raise"
    )


class SkillOptRun(Base, UUIDMixin, TimestampMixin):
    """One epoch of a SkillOpt optimization."""

    __tablename__ = "skill_opt_runs"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skill_opt_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    edits_proposed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edits_accepted: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edits_rejected: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rollout_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="completed", nullable=False)

    project: Mapped[SkillOptProject] = relationship(back_populates="runs", lazy="raise")
