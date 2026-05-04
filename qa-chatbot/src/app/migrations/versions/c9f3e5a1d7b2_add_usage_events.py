"""add usage_events table and backfill from messages + health_scores

Revision ID: c9f3e5a1d7b2
Revises: b8e2d4f1c5a3
Create Date: 2026-05-04 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9f3e5a1d7b2"
down_revision: str | Sequence[str] | None = "b8e2d4f1c5a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("credits_spent", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_usage_events_user_id"), "usage_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_usage_events_action"), "usage_events", ["action"], unique=False)
    op.create_index(
        op.f("ix_usage_events_created_at"),
        "usage_events",
        ["created_at"],
        unique=False,
    )

    # Backfill: every existing assistant message with a response = one optimize event.
    # We can't recover historical health_score / advisory calls (no log was kept),
    # so they start at zero — going forward every call is logged.
    op.execute(
        """
        INSERT INTO usage_events (id, user_id, action, credits_spent, created_at)
        SELECT
            gen_random_uuid(),
            cs.user_id,
            'optimize',
            10,
            m.created_at
        FROM messages m
        JOIN chat_sessions cs ON cs.id = m.session_id
        WHERE m.response IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_usage_events_created_at"), table_name="usage_events")
    op.drop_index(op.f("ix_usage_events_action"), table_name="usage_events")
    op.drop_index(op.f("ix_usage_events_user_id"), table_name="usage_events")
    op.drop_table("usage_events")
