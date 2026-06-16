"""rename clerk_user_id to supabase_user_id

Revision ID: c1d2e3f4a5b6
Revises: e9c7a5f3b1d2
Create Date: 2026-05-28 00:00:00.000000

"""

from alembic import op

revision = "c1d2e3f4a5b6"
down_revision = "e9c7a5f3b1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "clerk_user_id", new_column_name="supabase_user_id")
    op.execute("ALTER INDEX IF EXISTS ix_users_clerk_user_id RENAME TO ix_users_supabase_user_id")


def downgrade() -> None:
    op.execute("ALTER INDEX IF EXISTS ix_users_supabase_user_id RENAME TO ix_users_clerk_user_id")
    op.alter_column("users", "supabase_user_id", new_column_name="clerk_user_id")
