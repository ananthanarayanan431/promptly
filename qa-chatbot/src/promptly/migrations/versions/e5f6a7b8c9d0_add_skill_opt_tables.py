"""add skill_opt tables

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "skill_opt_projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("task_description", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "optimizing",
                "completed",
                "failed",
                "cancelled",
                name="skill_opt_status",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("seed_skill", sa.Text(), nullable=True),
        sa.Column("best_skill", sa.Text(), nullable=True),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
        sa.Column("epochs_run", sa.Integer(), nullable=True),
        sa.Column("edits_accepted", sa.Integer(), nullable=True),
        sa.Column("edits_rejected", sa.Integer(), nullable=True),
        sa.Column("example_count", sa.Integer(), nullable=True),
        sa.Column("credits_charged", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skill_opt_projects_user_id", "skill_opt_projects", ["user_id"])

    op.create_table(
        "skill_opt_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
        sa.Column("edits_proposed", sa.Integer(), nullable=True),
        sa.Column("edits_accepted", sa.Integer(), nullable=True),
        sa.Column("edits_rejected", sa.Integer(), nullable=True),
        sa.Column("rollout_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["project_id"], ["skill_opt_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skill_opt_runs_project_id", "skill_opt_runs", ["project_id"])


def downgrade() -> None:
    op.drop_table("skill_opt_runs")
    op.drop_table("skill_opt_projects")
    sa.Enum(name="skill_opt_status").drop(op.get_bind(), checkfirst=True)
