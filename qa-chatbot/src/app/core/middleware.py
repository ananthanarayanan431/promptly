import asyncio
import uuid
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.types.response import ResponseError
from app.config.app import get_app_settings
from app.config.rate_limit import get_rate_limit_settings
from app.db.redis import get_redis_client


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Any:
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        try:
            response = await call_next(request)
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        except ResponseError as e:
            return JSONResponse(status_code=e.error.code, content={"detail": e.error.message})


_HEALTH_PATHS = {"/api/v1/health", "/api/v1/ready"}
_AUTH_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed fixed-window rate limiter keyed by client IP.

    - /api/v1/health and /api/v1/ready are bypassed entirely.
    - Auth endpoints use a tight per-IP bucket (RATE_LIMIT_AUTH_REQUESTS / window).
    - All other routes share the global per-IP bucket (RATE_LIMIT_REQUESTS / window).
    - Reads X-Forwarded-For so the real client IP is used behind a reverse proxy.
    """

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        path = request.url.path

        if path in _HEALTH_PATHS:
            return await call_next(request)

        settings = get_rate_limit_settings()
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        elif request.client:
            client_ip = request.client.host
        else:
            return await call_next(request)

        if path in _AUTH_PATHS:
            limit = settings.RATE_LIMIT_AUTH_REQUESTS
            window = settings.RATE_LIMIT_AUTH_WINDOW_SECONDS
            key = f"rl:auth:{client_ip}"
        else:
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
