"""add_status_and_error_to_optimization_runs

Revision ID: e7e10373f81e
Revises: 17fd582f0ba7
Create Date: 2026-05-10 09:51:46.708065

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7e10373f81e"
down_revision: str | Sequence[str] | None = "17fd582f0ba7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "domain_optimization_runs",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="completed"),
    )
    op.add_column("domain_optimization_runs", sa.Column("error_message", sa.Text(), nullable=True))
    op.alter_column(
        "domain_optimization_runs", "optimized_prompt", existing_type=sa.TEXT(), nullable=True
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "domain_optimization_runs", "optimized_prompt", existing_type=sa.TEXT(), nullable=False
    )
    op.drop_column("domain_optimization_runs", "error_message")
    op.drop_column("domain_optimization_runs", "status")
