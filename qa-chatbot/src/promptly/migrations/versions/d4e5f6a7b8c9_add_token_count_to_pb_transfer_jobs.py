"""add token_count to pb_transfer_jobs

Revision ID: d4e5f6a7b8c9
Revises: c2d3e4f5a6b8
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c2d3e4f5a6b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pb_transfer_jobs",
        sa.Column("token_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pb_transfer_jobs", "token_count")
