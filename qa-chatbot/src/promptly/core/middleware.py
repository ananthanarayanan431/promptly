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
_NUMERIC_ID_RE = re.compile(r"(?<=/)\d{6,}(?=/|$)")
_LOG_SKIP_PREFIXES = ("/docs", "/redoc", "/openapi", "/_", "/favicon")
_background_tasks: set[asyncio.Task[None]] = set()
_log_semaphore = asyncio.Semaphore(20)


async def _write_request_log(
    method: str,
    path: str,
    status_code: int,
    duration_ms: int,
    user_id: str | None,
    query_params: str | None = None,
    error_message: str | None = None,
) -> None:
    from promptly.db.session import AsyncSessionLocal  # lazy to avoid circular import
    from promptly.models.api_request_log import ApiRequestLog  # lazy to avoid circular import

    async with _log_semaphore:
        try:
            async with AsyncSessionLocal() as session:
                session.add(
                    ApiRequestLog(
                        method=method,
                        path=path,
                        status_code=status_code,
                        duration_ms=duration_ms,
                        user_id=user_id,
                        query_params=query_params,
                        error_message=error_message,
                    )
                )
                await session.commit()
        except Exception:  # noqa: S110
            pass


def _extract_user_id(auth_header: str) -> str | None:
    """Decode JWT sub claim without verification — for logging only."""
    if not auth_header.startswith("Bearer "):
        return None
    try:
        import base64
        import json as _json

        payload_b64 = auth_header[7:].split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        return str(_json.loads(base64.b64decode(payload_b64)).get("sub") or "") or None
    except Exception:  # noqa: BLE001, S110
        return None


class HttpRequestLogMiddleware(BaseHTTPMiddleware):
    """Append every request to api_request_logs via a fire-and-forget background task."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        from starlette.responses import Response as _StarletteResponse

        path = request.url.path
        if path in _SKIP_PATHS or any(path.startswith(p) for p in _LOG_SKIP_PREFIXES):
            return await call_next(request)

        start = time.monotonic()
        status_code = 500
        error_message: str | None = None
        raw_query = request.url.query
        query_params: str | None = raw_query[:500] if raw_query else None

        try:
            response = await call_next(request)
            status_code = response.status_code

            # Capture JSON error body for 4xx/5xx without breaking streaming responses
            if status_code >= 400 and "application/json" in response.headers.get(
                "content-type", ""
            ):
                try:
                    chunks: list[bytes] = []
                    async for chunk in response.body_iterator:
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    error_message = body.decode("utf-8", errors="replace")[:500]
                    headers = {
                        k: v for k, v in response.headers.items() if k.lower() != "content-length"
                    }
                    response = _StarletteResponse(
                        content=body,
                        status_code=status_code,
                        headers=headers,
                        media_type="application/json",
                    )
                except Exception:  # noqa: BLE001, S110
                    pass

            return response
        except Exception as exc:  # noqa: BLE001
            error_message = f"{type(exc).__name__}: {exc}"[:500]
            raise
        finally:
            duration_ms = int((time.monotonic() - start) * 1000)
            normalized = _NUMERIC_ID_RE.sub("{id}", _UUID_RE.sub("{id}", path))[:255]
            user_id = _extract_user_id(request.headers.get("Authorization", ""))
            try:
                task: asyncio.Task[None] = asyncio.create_task(
                    _write_request_log(
                        request.method,
                        normalized,
                        status_code,
                        duration_ms,
                        user_id,
                        query_params=query_params,
                        error_message=error_message,
                    )
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
