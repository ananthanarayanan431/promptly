"""clerk_auth_migration

Revision ID: d8ade696985f
Revises: 4a36d01781da
Create Date: 2026-05-17 15:54:12.340035

"""

# ruff: noqa: E501
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8ade696985f"
down_revision: str | Sequence[str] | None = "4a36d01781da"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── users table ────────────────────────────────────────────────────────────
    # Add clerk_user_id as nullable first (will be backfilled before making NOT NULL)
    op.add_column("users", sa.Column("clerk_user_id", sa.String(length=255), nullable=True))
    op.create_index(op.f("ix_users_clerk_user_id"), "users", ["clerk_user_id"], unique=True)

    # Drop columns removed by Clerk migration (order: indexes before columns)
    op.drop_index(op.f("ix_users_api_key_hash"), table_name="users")
    op.drop_column("users", "hashed_password")
    op.drop_column("users", "api_key_hash")
    op.drop_column("users", "is_superuser")

    # ── api_keys table ─────────────────────────────────────────────────────────
    # Drop old partial index before altering columns it references
    op.drop_index(
        "uq_api_keys_user_active_name",
        table_name="api_keys",
        postgresql_where=sa.text("is_active = true"),
    )

    # Add new columns (nullable first so we can populate from existing data)
    op.add_column("api_keys", sa.Column("org_id", sa.String(length=255), nullable=True))
    op.add_column("api_keys", sa.Column("created_by", sa.Uuid(), nullable=True))
    op.add_column("api_keys", sa.Column("last_used_at", sa.DateTime(timezone=False), nullable=True))

    # Populate created_by from the existing user_id column (before we drop it)
    op.execute("UPDATE api_keys SET created_by = user_id, org_id = '' WHERE created_by IS NULL")

    # Drop old FK + index on user_id
    op.drop_constraint("api_keys_user_id_fkey", "api_keys", type_="foreignkey")
    op.drop_index(op.f("ix_api_keys_user_id"), table_name="api_keys")

    # Drop old user_id column
    op.drop_column("api_keys", "user_id")

    # Now make org_id and created_by NOT NULL (all rows have been populated)
    op.alter_column("api_keys", "org_id", nullable=False)
    op.alter_column("api_keys", "created_by", nullable=False)

    # Add FK constraint for created_by → users.id
    op.create_foreign_key(
        "api_keys_created_by_fkey",
        "api_keys",
        "users",
        ["created_by"],
        ["id"],
        ondelete="CASCADE",
    )

    # Create new indexes
    op.create_index(op.f("ix_api_keys_org_id"), "api_keys", ["org_id"], unique=False)
    op.create_index(op.f("ix_api_keys_created_by"), "api_keys", ["created_by"], unique=False)
    op.create_index(
        "uq_api_keys_org_active_name",
        "api_keys",
        ["org_id", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # ── api_keys table ─────────────────────────────────────────────────────────
    # Drop new indexes and constraints
    op.drop_index(
        "uq_api_keys_org_active_name",
        table_name="api_keys",
        postgresql_where=sa.text("is_active = true"),
    )
    op.drop_index(op.f("ix_api_keys_created_by"), table_name="api_keys")
    op.drop_index(op.f("ix_api_keys_org_id"), table_name="api_keys")
    op.drop_constraint("api_keys_created_by_fkey", "api_keys", type_="foreignkey")

    # Add user_id back (nullable first, then populate from created_by)
    op.add_column("api_keys", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE api_keys SET user_id = created_by WHERE user_id IS NULL")
    op.alter_column("api_keys", "user_id", nullable=False)

    # Restore old FK + index on user_id
    op.create_foreign_key(
        "api_keys_user_id_fkey", "api_keys", "users", ["user_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index(op.f("ix_api_keys_user_id"), "api_keys", ["user_id"], unique=False)
    op.create_index(
        "uq_api_keys_user_active_name",
        "api_keys",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    # Drop new columns
    op.drop_column("api_keys", "last_used_at")
    op.drop_column("api_keys", "created_by")
    op.drop_column("api_keys", "org_id")

    # ── users table ────────────────────────────────────────────────────────────
    # Drop clerk_user_id
    op.drop_index(op.f("ix_users_clerk_user_id"), table_name="users")
    op.drop_column("users", "clerk_user_id")

    # Restore removed columns (nullable so they work on existing rows)
    op.add_column(
        "users",
        sa.Column("hashed_password", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("api_key_hash", sa.VARCHAR(length=255), autoincrement=False, nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("is_superuser", sa.BOOLEAN(), autoincrement=False, nullable=True),
    )
    op.create_index(op.f("ix_users_api_key_hash"), "users", ["api_key_hash"], unique=False)
