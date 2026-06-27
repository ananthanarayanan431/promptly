"""Add user_id to api_request_logs.

Revision ID: m1n2o3p4q5r6
Revises: l6m7n8o9p0q1
Create Date: 2026-06-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "m1n2o3p4q5r6"
down_revision = "l6m7n8o9p0q1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_request_logs", sa.Column("user_id", sa.Text(), nullable=True))
    op.create_index("ix_api_request_logs_user_id", "api_request_logs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_api_request_logs_user_id", table_name="api_request_logs")
    op.drop_column("api_request_logs", "user_id")
