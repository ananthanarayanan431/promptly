"""add_domain_optimization_runs

Revision ID: 17fd582f0ba7
Revises: f60caca2357b
Create Date: 2026-05-09 22:48:08.295992

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "17fd582f0ba7"
down_revision: str | Sequence[str] | None = "f60caca2357b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "domain_optimization_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("domain_id", sa.Uuid(), nullable=False),
        sa.Column("domain_name", sa.String(length=120), nullable=False),
        sa.Column("prompt_input", sa.Text(), nullable=False),
        sa.Column("optimized_prompt", sa.Text(), nullable=False),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
        sa.Column("win_rate", sa.Float(), nullable=True),
        sa.Column("candidates_tried", sa.Integer(), nullable=True),
        sa.Column("rounds_run", sa.Integer(), nullable=True),
        sa.Column("dataset_size", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["domain_id"], ["domain_prompts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_domain_optimization_runs_domain_id",
        "domain_optimization_runs",
        ["domain_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_domain_optimization_runs_domain_id", table_name="domain_optimization_runs")
    op.drop_table("domain_optimization_runs")
