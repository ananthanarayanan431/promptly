from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import CursorResult, text
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.models.api_request_log import (
    ApiRequestLog,  # noqa: F401 — ensures model is registered
)

_WINDOW_DELTAS: dict[str, timedelta | None] = {
    "1h": timedelta(hours=1),
    "12h": timedelta(hours=12),
    "1d": timedelta(days=1),
    "7d": timedelta(days=7),
    "all": None,
}


async def get_endpoint_errors(db: AsyncSession, path: str, days: int) -> dict[str, Any]:
    cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    status_rows = (
        await db.execute(
            text(
                "SELECT status_code, COUNT(*) AS cnt"
                " FROM api_request_logs"
                " WHERE path = :path AND status_code >= 400 AND created_at >= :cutoff"
                " GROUP BY status_code ORDER BY cnt DESC"
            ),
            {"path": path, "cutoff": cutoff},
        )
    ).fetchall()

    recent_rows = (
        await db.execute(
            text(
                "SELECT id, created_at, status_code, duration_ms, user_id,"
                "       method, query_params, error_message"
                " FROM api_request_logs"
                " WHERE path = :path AND status_code >= 400 AND created_at >= :cutoff"
                " ORDER BY created_at DESC LIMIT 50"
            ),
            {"path": path, "cutoff": cutoff},
        )
    ).fetchall()

    total_errors: int = sum(int(r.cnt) for r in status_rows)

    return {
        "path": path,
        "total_errors": total_errors,
        "status_breakdown": [
            {"status_code": int(r.status_code), "count": int(r.cnt)} for r in status_rows
        ],
        "recent_errors": [
            {
                "id": str(r.id),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "status_code": int(r.status_code),
                "duration_ms": int(r.duration_ms),
                "user_id": r.user_id,
                "method": r.method,
                "query_params": r.query_params,
                "error_message": r.error_message,
            }
            for r in recent_rows
        ],
    }


async def delete_endpoint_errors(db: AsyncSession, path: str, window: str) -> int:
    """Delete error logs for a path within a time window.

    window: '1h' | '12h' | '1d' | '7d' | 'all'
    Returns the number of rows deleted.
    """
    delta = _WINDOW_DELTAS[window]

    result: CursorResult[Any]
    if delta is None:
        result = await db.execute(  # type: ignore[assignment]
            text("DELETE FROM api_request_logs WHERE path = :path AND status_code >= 400"),
            {"path": path},
        )
    else:
        cutoff = datetime.now(UTC) - delta
        result = await db.execute(  # type: ignore[assignment]
            text(
                "DELETE FROM api_request_logs"
                " WHERE path = :path AND status_code >= 400 AND created_at >= :cutoff"
            ),
            {"path": path, "cutoff": cutoff},
        )

    await db.commit()
    return int(result.rowcount)
