"""add credits non-negative check constraint

Revision ID: a1b2c3d4e5f6
Revises: f7b0c1a2d3e4
Create Date: 2026-04-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "f7b0c1a2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint("ck_users_credits_non_negative", "users", sa.text("credits >= 0"))


def downgrade() -> None:
    op.drop_constraint("ck_users_credits_non_negative", "users", type_="check")
