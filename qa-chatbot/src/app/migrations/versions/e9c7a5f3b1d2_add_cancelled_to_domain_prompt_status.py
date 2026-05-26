"""add cancelled to domain_prompt_status enum

Revision ID: e9c7a5f3b1d2
Revises: d8ade696985f
Create Date: 2026-05-26 00:00:00.000000

"""

from __future__ import annotations

from alembic import op

revision: str = "e9c7a5f3b1d2"
down_revision: str = "d8ade696985f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE domain_prompt_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; a full type rebuild would be needed.
    pass
