"""add prompt_categories table and category_slug on messages

Revision ID: b8e2d4f1c5a3
Revises: f7b0c1a2d3e4
Create Date: 2026-04-30 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8e2d4f1c5a3"
down_revision: str | Sequence[str] | None = "77034d66d998"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PREDEFINED_CATEGORIES: list[tuple[str, str, str]] = [
    (
        "general",
        "General",
        "Default — applies the standard 8-dimension optimization with no special bias.",
    ),
    (
        "writing-content",
        "Writing & Content",
        "Blog posts, emails, marketing copy, social posts — tone and audience matter most.",
    ),
    (
        "summarization",
        "Summarization",
        "Condensing long inputs into shorter outputs at a target length and structure.",
    ),
    (
        "extraction",
        "Extraction",
        "Pulling structured fields (JSON, lists) from unstructured text — format and "
        "no-fabrication rules dominate.",
    ),
    (
        "classification",
        "Classification",
        "Assigning inputs to fixed categories or labels — clear taxonomy and edge-case "
        "rules dominate.",
    ),
    (
        "qa-rag",
        "Question Answering / RAG",
        "Answering questions from supplied context — grounding and don't-fabricate rules "
        "dominate.",
    ),
    (
        "code-generation",
        "Code Generation",
        "Writing, refactoring, or explaining code — language, signature, and style "
        "constraints dominate.",
    ),
    (
        "analysis-reasoning",
        "Analysis & Reasoning",
        "Multi-step reasoning, evaluation, comparison, decisions — explicit reasoning "
        "structure helps.",
    ),
    (
        "conversation-agent",
        "Conversation / Agent",
        "Chat agents, tool-using agents, multi-turn assistants — persona, scope, and "
        "refusal behavior dominate.",
    ),
    (
        "creative",
        "Creative",
        "Stories, poems, brainstorming, ideation — persona and tone dominate; format "
        "constraints loosened.",
    ),
]


def upgrade() -> None:
    op.create_table(
        "prompt_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "is_predefined",
            sa.Boolean(),
            server_default=sa.text("false"),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "slug", name="uq_prompt_category_user_slug"),
    )
    op.create_index(
        op.f("ix_prompt_categories_user_id"),
        "prompt_categories",
        ["user_id"],
        unique=False,
    )

    op.add_column("messages", sa.Column("category_slug", sa.String(length=40), nullable=True))

    # Seed predefined categories (user_id = NULL, is_predefined = true).
    categories_table = sa.table(
        "prompt_categories",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("slug", sa.String(length=40)),
        sa.column("name", sa.String(length=60)),
        sa.column("description", sa.Text()),
        sa.column("is_predefined", sa.Boolean()),
    )
    import uuid as _uuid

    op.bulk_insert(
        categories_table,
        [
            {
                "id": _uuid.uuid4(),
                "user_id": None,
                "slug": slug,
                "name": name,
                "description": description,
                "is_predefined": True,
            }
            for slug, name, description in PREDEFINED_CATEGORIES
        ],
    )


def downgrade() -> None:
    op.drop_column("messages", "category_slug")
    op.drop_index(op.f("ix_prompt_categories_user_id"), table_name="prompt_categories")
    op.drop_table("prompt_categories")
