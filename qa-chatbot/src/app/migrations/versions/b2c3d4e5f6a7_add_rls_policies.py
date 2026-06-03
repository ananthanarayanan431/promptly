"""add RLS policies for all user-data tables

Revision ID: b2c3d4e5f6a7
Revises: c1d2e3f4a5b6
Create Date: 2026-05-28 00:01:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None

_USER_DATA_TABLES = [
    "chat_sessions",
    "messages",
    "prompt_versions",
    "favorite_prompts",
    "api_keys",
    "usage_events",
]


def _is_supabase() -> bool:
    """Detect Supabase by checking whether the 'auth' schema exists.

    auth.uid() is Supabase-only — local Docker Postgres does not have it.
    RLS is enabled on all envs, but auth.uid() policies are Supabase-only.
    Returns False in offline mode (no DB connection available).
    """
    from alembic import context as alembic_context

    if alembic_context.is_offline_mode():
        return False
    bind = op.get_bind()
    result = bind.execute(sa.text("SELECT 1 FROM pg_namespace WHERE nspname = 'auth'")).fetchone()
    return result is not None


def upgrade() -> None:
    # Enable RLS on all tables — safe on both local and Supabase.
    # The backend service role key bypasses these policies automatically.
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    for table in _USER_DATA_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE templates ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY templates_read ON templates FOR SELECT USING (true)")
    op.execute("ALTER TABLE prompt_categories ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY categories_read ON prompt_categories FOR SELECT USING (true)")

    # auth.uid() policies only apply on Supabase — skip on local Postgres.
    if not _is_supabase():
        return

    op.execute(
        "CREATE POLICY users_self ON users FOR ALL USING (supabase_user_id = auth.uid()::text)"
    )
    op.execute(
        "CREATE POLICY sessions_own ON chat_sessions FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY messages_own ON messages FOR ALL USING ("
        "  session_id IN ("
        "    SELECT cs.id FROM chat_sessions cs"
        "    JOIN users u ON cs.user_id = u.id"
        "    WHERE u.supabase_user_id = auth.uid()::text"
        "  )"
        ")"
    )
    op.execute(
        "CREATE POLICY prompt_versions_own ON prompt_versions FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY favorites_own ON favorite_prompts FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY api_keys_own ON api_keys FOR ALL USING ("
        "  created_by = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY usage_events_own ON usage_events FOR SELECT USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS categories_read ON prompt_categories")
    op.execute("ALTER TABLE prompt_categories DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS templates_read ON templates")
    op.execute("ALTER TABLE templates DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS usage_events_own ON usage_events")
    op.execute("DROP POLICY IF EXISTS api_keys_own ON api_keys")
    op.execute("DROP POLICY IF EXISTS favorites_own ON favorite_prompts")
    op.execute("DROP POLICY IF EXISTS prompt_versions_own ON prompt_versions")
    op.execute("DROP POLICY IF EXISTS messages_own ON messages")
    op.execute("DROP POLICY IF EXISTS sessions_own ON chat_sessions")
    for table in _USER_DATA_TABLES:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS users_self ON users")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY")
