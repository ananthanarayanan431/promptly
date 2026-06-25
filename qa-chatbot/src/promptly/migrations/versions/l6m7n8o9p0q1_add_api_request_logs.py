"""add_api_request_logs

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-06-26 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "l6m7n8o9p0q1"
down_revision: str | None = "k5l6m7n8o9p0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_request_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_request_logs_path", "api_request_logs", ["path"])
    op.create_index("ix_api_request_logs_status_code", "api_request_logs", ["status_code"])
    op.create_index("ix_api_request_logs_created_at", "api_request_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_api_request_logs_created_at", table_name="api_request_logs")
    op.drop_index("ix_api_request_logs_status_code", table_name="api_request_logs")
    op.drop_index("ix_api_request_logs_path", table_name="api_request_logs")
    op.drop_table("api_request_logs")
