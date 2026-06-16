"""add favorite_prompts table

Revision ID: f7b0c1a2d3e4
Revises: e6f7a8b9c0d1
Create Date: 2026-04-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7b0c1a2d3e4"
down_revision: str | Sequence[str] | None = "e6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite_prompts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_version_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
        sa.Column(
            "category",
            sa.String(length=20),
            server_default=sa.text("'Other'"),
            nullable=False,
        ),
        sa.Column("is_pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("use_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "liked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(["prompt_version_id"], ["prompt_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "prompt_version_id", name="uq_favorite_user_version"),
    )
    op.create_index(
        op.f("ix_favorite_prompts_user_id"),
        "favorite_prompts",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_favorite_prompts_prompt_version_id"),
        "favorite_prompts",
        ["prompt_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_favorite_prompts_user_pinned_liked",
        "favorite_prompts",
        ["user_id", "is_pinned"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_favorite_prompts_user_pinned_liked", table_name="favorite_prompts")
    op.drop_index(op.f("ix_favorite_prompts_prompt_version_id"), table_name="favorite_prompts")
    op.drop_index(op.f("ix_favorite_prompts_user_id"), table_name="favorite_prompts")
    op.drop_table("favorite_prompts")
