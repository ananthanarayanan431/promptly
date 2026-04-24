"""add_prompt_version_id_to_messages

Revision ID: ad8715758574
Revises: f7b0c1a2d3e4
Create Date: 2026-04-24 13:50:07.376544

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ad8715758574"
down_revision: str | Sequence[str] | None = "f7b0c1a2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("prompt_version_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_messages_prompt_version_id", "messages", ["prompt_version_id"], unique=False
    )
    op.create_foreign_key(
        None, "messages", "prompt_versions", ["prompt_version_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("messages_prompt_version_id_fkey", "messages", type_="foreignkey")
    op.drop_index("ix_messages_prompt_version_id", table_name="messages")
    op.drop_column("messages", "prompt_version_id")
