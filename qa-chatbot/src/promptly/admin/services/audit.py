from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from promptly.models.admin_audit_log import AdminAuditLog

FEATURE_LABELS: dict[str, str] = {
    "optimize": "Council Optimizer",
    "health_score": "Health Score",
    "advisory": "Advisory",
    "domain_pdo": "Domain PDO",
    "domain_gepa": "Domain GEPA",
    "bridge": "Bridge",
    "domain_gepa_augment": "Dataset Augment",
}


def log_audit(
    db: AsyncSession,
    admin_id: uuid.UUID,
    action: str,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AdminAuditLog:
    """Create an AdminAuditLog record and add it to the session (no flush/commit)."""
    entry = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_id=target_id,
        details=details,
    )
    db.add(entry)
    return entry
