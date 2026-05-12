"""add_prompt_bridge_tables

Revision ID: 6e0e77f64d57
Revises: e7e10373f81e
Create Date: 2026-05-12 21:02:09.655127

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6e0e77f64d57"
down_revision: str | Sequence[str] | None = "e7e10373f81e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "pb_prompt_mappings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source_model", sa.String(length=120), nullable=False),
        sa.Column("target_model", sa.String(length=120), nullable=False),
        sa.Column("mapping_text", sa.Text(), nullable=False),
        sa.Column("pair_count", sa.Integer(), nullable=False),
        sa.Column("avg_source_score", sa.Float(), nullable=True),
        sa.Column("avg_target_score", sa.Float(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pb_prompt_mappings_user_id"), "pb_prompt_mappings", ["user_id"], unique=False
    )

    op.create_table(
        "pb_prompt_pairs",
        sa.Column("mapping_id", sa.Uuid(), nullable=False),
        sa.Column("source_optimal_prompt", sa.Text(), nullable=False),
        sa.Column("target_optimal_prompt", sa.Text(), nullable=False),
        sa.Column("source_score", sa.Float(), nullable=True),
        sa.Column("target_score", sa.Float(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["mapping_id"], ["pb_prompt_mappings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pb_prompt_pairs_mapping_id"), "pb_prompt_pairs", ["mapping_id"], unique=False
    )

    op.create_table(
        "pb_transfer_jobs",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source_prompt", sa.Text(), nullable=False),
        sa.Column("source_model", sa.String(length=120), nullable=False),
        sa.Column("target_model", sa.String(length=120), nullable=False),
        sa.Column("adapted_prompt", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "calibrating",
                "extracting_mapping",
                "adapting",
                "completed",
                "failed",
                name="pb_transfer_job_status",
            ),
            nullable=False,
        ),
        sa.Column("mapping_id", sa.Uuid(), nullable=True),
        sa.Column("reused_mapping", sa.Boolean(), nullable=False),
        sa.Column("credits_charged", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["mapping_id"], ["pb_prompt_mappings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pb_transfer_jobs_mapping_id"), "pb_transfer_jobs", ["mapping_id"], unique=False
    )
    op.create_index(
        op.f("ix_pb_transfer_jobs_user_id"), "pb_transfer_jobs", ["user_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_pb_transfer_jobs_user_id"), table_name="pb_transfer_jobs")
    op.drop_index(op.f("ix_pb_transfer_jobs_mapping_id"), table_name="pb_transfer_jobs")
    op.drop_table("pb_transfer_jobs")
    op.drop_index(op.f("ix_pb_prompt_pairs_mapping_id"), table_name="pb_prompt_pairs")
    op.drop_table("pb_prompt_pairs")
    op.drop_index(op.f("ix_pb_prompt_mappings_user_id"), table_name="pb_prompt_mappings")
    op.drop_table("pb_prompt_mappings")
    op.execute("DROP TYPE IF EXISTS pb_transfer_job_status")
