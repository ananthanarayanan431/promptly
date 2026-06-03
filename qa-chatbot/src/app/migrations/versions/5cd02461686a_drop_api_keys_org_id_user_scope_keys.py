"""drop api_keys org_id, user-scope keys

Revision ID: 5cd02461686a
Revises: b2c3d4e5f6a7
Create Date: 2026-06-03 18:39:38.572631

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5cd02461686a"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("uq_api_keys_org_active_name", table_name="api_keys")
    op.drop_index("ix_api_keys_org_id", table_name="api_keys")
    op.drop_column("api_keys", "org_id")
    op.create_index(
        "uq_api_keys_user_active_name",
        "api_keys",
        ["created_by", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_api_keys_user_active_name", table_name="api_keys")
    op.add_column("api_keys", sa.Column("org_id", sa.String(length=255), nullable=True))
    op.execute("UPDATE api_keys SET org_id = created_by::text WHERE org_id IS NULL")
    op.alter_column("api_keys", "org_id", nullable=False)
    op.create_index("ix_api_keys_org_id", "api_keys", ["org_id"], unique=False)
    op.create_index(
        "uq_api_keys_org_active_name",
        "api_keys",
        ["org_id", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )
