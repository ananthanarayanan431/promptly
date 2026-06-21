"""add algorithm to domain_optimization_runs

Revision ID: b1c2d3e4f5a7
Revises: 5cd02461686a
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a7"
down_revision: str | Sequence[str] | None = "5cd02461686a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "domain_optimization_runs",
        sa.Column(
            "algorithm",
            sa.String(length=10),
            nullable=False,
            server_default="pdo",
        ),
    )


def downgrade() -> None:
    op.drop_column("domain_optimization_runs", "algorithm")
