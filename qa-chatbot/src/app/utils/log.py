"""
Central logger factory for the entire application.

Usage in any module:
    from app.utils.log import get_logger
    log = get_logger(__name__)

Context is bound per-request via structlog.contextvars (correlation_id, user_id, job_id).
Extra fields can be added inline:
    log.info("event_name", key=value)
or scoped to a block:
    bound = log.bind(order_id=42)
    bound.info("processing")
"""

from typing import cast

import structlog


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger. Pass __name__ so log records include the module."""
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))
