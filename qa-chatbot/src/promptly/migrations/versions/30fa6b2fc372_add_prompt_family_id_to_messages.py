"""add_prompt_family_id_to_messages

Revision ID: 30fa6b2fc372
Revises: ad8715758574
Create Date: 2026-04-24 18:20:14.319657

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "30fa6b2fc372"
down_revision: str | Sequence[str] | None = "ad8715758574"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("prompt_family_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "prompt_family_id")
