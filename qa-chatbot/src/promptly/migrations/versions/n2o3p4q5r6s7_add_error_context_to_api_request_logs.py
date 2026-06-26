"""Add query_params and error_message to api_request_logs.

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2026-06-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "n2o3p4q5r6s7"
down_revision = "m1n2o3p4q5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_request_logs", sa.Column("query_params", sa.Text(), nullable=True))
    op.add_column("api_request_logs", sa.Column("error_message", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("api_request_logs", "error_message")
    op.drop_column("api_request_logs", "query_params")
