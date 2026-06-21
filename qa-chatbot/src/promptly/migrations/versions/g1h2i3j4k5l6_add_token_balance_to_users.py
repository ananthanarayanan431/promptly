"""add token_balance to users

Revision ID: g1h2i3j4k5l6
Revises: f7b0c1a2d3e4
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "g1h2i3j4k5l6"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add token_balance column; existing users receive 3 M tokens to match new-user default.
    op.add_column(
        "users",
        sa.Column(
            "token_balance",
            sa.BigInteger(),
            nullable=False,
            server_default="3000000",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "token_balance")
