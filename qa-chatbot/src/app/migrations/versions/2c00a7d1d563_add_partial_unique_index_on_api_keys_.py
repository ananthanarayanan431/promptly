"""add partial unique index on api_keys user_id name where is_active

Revision ID: 2c00a7d1d563
Revises: 92476c4aceae
Create Date: 2026-04-26 18:19:01.880061

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2c00a7d1d563"
down_revision: str | Sequence[str] | None = "92476c4aceae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_api_keys_user_active_name",
        "api_keys",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_api_keys_user_active_name",
        table_name="api_keys",
        postgresql_where=sa.text("is_active = true"),
    )
