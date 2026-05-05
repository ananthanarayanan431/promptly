"""add job_id to usage_events for retry-safe optimize logging

Revision ID: e1b6f8c4a2d3
Revises: d4a7c2e9b1f5
Create Date: 2026-05-04 00:02:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1b6f8c4a2d3"
down_revision: str | Sequence[str] | None = "d4a7c2e9b1f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("usage_events", sa.Column("job_id", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_usage_events_job_id"), "usage_events", ["job_id"], unique=False)
    # Unique constraint on (action, job_id): rows with job_id=NULL are not
    # deduped (Postgres treats NULLs as distinct), which matches the intent —
    # only Celery-driven actions need retry-safety.
    op.create_unique_constraint("uq_usage_events_action_job", "usage_events", ["action", "job_id"])


def downgrade() -> None:
    op.drop_constraint("uq_usage_events_action_job", "usage_events", type_="unique")
    op.drop_index(op.f("ix_usage_events_job_id"), table_name="usage_events")
    op.drop_column("usage_events", "job_id")
