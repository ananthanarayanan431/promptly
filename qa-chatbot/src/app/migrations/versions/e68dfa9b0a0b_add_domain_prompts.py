"""add_domain_prompts

Revision ID: e68dfa9b0a0b
Revises: e1b6f8c4a2d3
Create Date: 2026-05-06 23:07:13.274966

"""

# ruff: noqa: E501
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e68dfa9b0a0b"
down_revision: str | Sequence[str] | None = "e1b6f8c4a2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "domain_prompts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_prompt", sa.Text(), nullable=False),
        sa.Column("optimized_prompt", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "preparing_dataset",
                "optimizing",
                "completed",
                "failed",
                name="domain_prompt_status",
            ),
            nullable=False,
        ),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_domain_prompts_user_id"), "domain_prompts", ["user_id"], unique=False)
    op.create_table(
        "domain_datasets",
        sa.Column("domain_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("minio_bucket", sa.String(length=120), nullable=False),
        sa.Column("pdf_key", sa.String(length=500), nullable=False),
        sa.Column("dataset_key", sa.String(length=500), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
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
        sa.ForeignKeyConstraint(["domain_id"], ["domain_prompts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_domain_datasets_domain_id"),
        "domain_datasets",
        ["domain_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_domain_datasets_user_id"),
        "domain_datasets",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_domain_datasets_user_id"), table_name="domain_datasets")
    op.drop_index(op.f("ix_domain_datasets_domain_id"), table_name="domain_datasets")
    op.drop_table("domain_datasets")
    op.drop_index(op.f("ix_domain_prompts_user_id"), table_name="domain_prompts")
    op.drop_table("domain_prompts")
    op.execute("DROP TYPE IF EXISTS domain_prompt_status")
