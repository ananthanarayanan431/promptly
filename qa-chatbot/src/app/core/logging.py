import logging
import sys
import time
from typing import Any

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


def setup_logging(debug: bool = False) -> None:
    """Call once at app startup (FastAPI lifespan). Also call setup_worker_logging() in Celery."""
    log_level = logging.DEBUG if debug else logging.INFO

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if debug:
        processors = shared_processors + [structlog.dev.ConsoleRenderer()]
    else:
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,  # type: ignore[arg-type]
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Route uvicorn / sqlalchemy / httpx stdlib logs through structlog
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=log_level)
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def setup_worker_logging(debug: bool = False) -> None:
    """Call at the top of each Celery task (after asyncio.run creates a new event loop)."""
    setup_logging(debug=debug)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs method, path, status, and duration for every HTTP request."""

    _SKIP_PATHS = {"/api/v1/health", "/api/v1/ready"}

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        if request.url.path in self._SKIP_PATHS:
            return await call_next(request)

        log = structlog.get_logger()
        t0 = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - t0) * 1000, 1)

        log.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        return response
