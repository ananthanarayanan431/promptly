"""add_score_test_to_skill_opt_projects

Revision ID: b70c6a7d022a
Revises: k5l6m7n8o9p0
Create Date: 2026-06-23 12:20:10.006574

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b70c6a7d022a"
down_revision: str | Sequence[str] | None = "k5l6m7n8o9p0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "skill_opt_projects",
        sa.Column("score_test", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("skill_opt_projects", "score_test")
