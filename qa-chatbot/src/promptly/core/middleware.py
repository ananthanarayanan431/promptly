import asyncio
import re
import time
import uuid
from typing import Any

import sentry_sdk
import structlog
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from promptly.config.app import get_app_settings
from promptly.config.rate_limit import get_rate_limit_settings
from promptly.db.redis import get_redis_client

_SKIP_PATHS = {"/api/v1/health", "/api/v1/ready"}

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
_LOG_SKIP_PREFIXES = ("/docs", "/redoc", "/openapi", "/_", "/favicon")
_background_tasks: set[asyncio.Task[None]] = set()


async def _write_request_log(method: str, path: str, status_code: int, duration_ms: int) -> None:
    from promptly.db.session import AsyncSessionLocal  # lazy to avoid circular import
    from promptly.models.api_request_log import ApiRequestLog  # lazy to avoid circular import

    try:
        async with AsyncSessionLocal() as session:
            session.add(
                ApiRequestLog(
                    method=method,
                    path=path,
                    status_code=status_code,
                    duration_ms=duration_ms,
                )
            )
            await session.commit()
    except Exception:  # noqa: S110
        pass


class HttpRequestLogMiddleware(BaseHTTPMiddleware):
    """Append every request to api_request_logs via a fire-and-forget background task."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        path = request.url.path
        if path in _SKIP_PATHS or any(path.startswith(p) for p in _LOG_SKIP_PREFIXES):
            return await call_next(request)

        start = time.monotonic()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = int((time.monotonic() - start) * 1000)
            normalized = _UUID_RE.sub("{id}", path)[:255]
            try:
                task: asyncio.Task[None] = asyncio.create_task(
                    _write_request_log(request.method, normalized, status_code, duration_ms)
                )
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
            except Exception:  # noqa: S110
                pass


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Any:
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        # Bind to structlog contextvars so every log in this request includes it,
        # and tag Sentry so events cross-link to the same ID that appears in the logs.
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(correlation_id=correlation_id)
        sentry_sdk.set_tag("correlation_id", correlation_id)
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed fixed-window rate limiter keyed by client IP.

    - Health/ready endpoints and OPTIONS preflight requests are bypassed.
    - All other routes share the global per-IP bucket (RATE_LIMIT_REQUESTS / window).
    - Reads X-Forwarded-For so the real client IP is used behind a reverse proxy.
    """

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        path = request.url.path

        # Skip health checks and CORS preflight requests entirely
        if path in _SKIP_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        settings = get_rate_limit_settings()
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        elif request.client:
            client_ip = request.client.host
        else:
            return await call_next(request)

        limit = settings.RATE_LIMIT_REQUESTS
        window = settings.RATE_LIMIT_WINDOW_SECONDS
        key = f"rl:{client_ip}"

        redis = await get_redis_client()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window, nx=True)
        results: list[int] = await pipe.execute()
        count: int = results[0]

        if count > limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down."},
                headers={"Retry-After": str(window)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response


class RequestLimitMiddleware(BaseHTTPMiddleware):
    """Rejects oversized request bodies and enforces a per-request timeout."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_app_settings()

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                cl = int(content_length)
            except ValueError:
                return JSONResponse(
                    status_code=400, content={"detail": "Invalid Content-Length header"}
                )
            if cl > settings.MAX_REQUEST_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Request body too large"},
                )

        try:
            return await asyncio.wait_for(
                call_next(request),
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            return JSONResponse(
                status_code=504,
                content={"detail": "Request timed out"},
            )
