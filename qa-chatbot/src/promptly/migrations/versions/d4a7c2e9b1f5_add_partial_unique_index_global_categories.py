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

import sqlalchemy as sa
from alembic import op

revision: str = "d4a7c2e9b1f5"
down_revision: str | Sequence[str] | None = "c9f3e5a1d7b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "uq_prompt_category_slug_when_global"


def upgrade() -> None:
    # Pre-flight: refuse to apply if duplicate global slugs already exist —
    # the CREATE UNIQUE INDEX would otherwise fail mid-migration with an opaque
    # UniqueViolation. Surface the offending slugs so the operator can dedupe
    # before re-running.
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            "SELECT slug, COUNT(*) AS n FROM prompt_categories "
            "WHERE user_id IS NULL GROUP BY slug HAVING COUNT(*) > 1"
        )
    ).all()
    if duplicates:
        offenders = ", ".join(f"{row.slug} (×{row.n})" for row in duplicates)
        raise RuntimeError(
            f"Cannot create {INDEX_NAME}: duplicate global category slugs found "
            f"in prompt_categories WHERE user_id IS NULL — {offenders}. "
            "Resolve duplicates manually (delete or rename rows) before re-running "
            "this migration."
        )

    op.execute(f"CREATE UNIQUE INDEX {INDEX_NAME} ON prompt_categories(slug) WHERE user_id IS NULL")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
