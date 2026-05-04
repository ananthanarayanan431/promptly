"""add partial unique index on prompt_categories(slug) where user_id is null

Revision ID: d4a7c2e9b1f5
Revises: c9f3e5a1d7b2
Create Date: 2026-05-04 00:01:00.000000

PostgreSQL treats NULLs as distinct in standard UNIQUE constraints. The existing
``uq_prompt_category_user_slug (user_id, slug)`` therefore allows multiple
predefined rows with the same slug (since user_id IS NULL). A partial unique
index closes this gap.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d4a7c2e9b1f5"
down_revision: str | Sequence[str] | None = "c9f3e5a1d7b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_prompt_category_slug_when_global "
        "ON prompt_categories(slug) WHERE user_id IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_prompt_category_slug_when_global")
