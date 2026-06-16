"""make_domain_base_prompt_nullable_add_last_prompt

Revision ID: 61a3a1374791
Revises: e68dfa9b0a0b
Create Date: 2026-05-07 09:53:13.527070

Domain is now a reusable knowledge base — base_prompt is supplied per-optimize
call, not at domain creation. Make base_prompt nullable and add last_prompt to
store whichever prompt was last optimized against this domain.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "61a3a1374791"
down_revision: str | Sequence[str] | None = "e68dfa9b0a0b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("domain_prompts", "base_prompt", nullable=True)
    op.add_column("domain_prompts", sa.Column("last_prompt", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("domain_prompts", "last_prompt")
    # restore NOT NULL — set empty string for any nulls first to avoid constraint violation
    op.execute("UPDATE domain_prompts SET base_prompt = '' WHERE base_prompt IS NULL")
    op.alter_column("domain_prompts", "base_prompt", nullable=False)
