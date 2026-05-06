"""add_feedback_to_message

Revision ID: 77034d66d998
Revises: 2c00a7d1d563
Create Date: 2026-04-27 23:11:15.362134

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "77034d66d998"
down_revision: str | Sequence[str] | None = "2c00a7d1d563"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("feedback", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "feedback")
