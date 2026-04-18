import asyncio
import uuid
from typing import Any

import redis.asyncio as aioredis
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.types.response import ResponseError
from app.config.app import get_app_settings
from app.config.rate_limit import get_rate_limit_settings
from app.config.redis import get_redis_settings


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


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed sliding-window rate limiter keyed by client IP."""

    def __init__(self, app: Any) -> None:
        super().__init__(app)
        redis_settings = get_redis_settings()
        self._redis: aioredis.Redis = aioredis.from_url(
            str(redis_settings.REDIS_URL),
            encoding="utf-8",
            decode_responses=True,
        )

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_rate_limit_settings()
        client_ip = request.client.host if request.client else "unknown"
        key = f"rl:{client_ip}"

        pipe = self._redis.pipeline()
        await pipe.incr(key)
        await pipe.expire(key, settings.RATE_LIMIT_WINDOW_SECONDS)
        results: list[int] = await pipe.execute()
        count: int = results[0]

        if count > settings.RATE_LIMIT_REQUESTS:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down."},
                headers={"Retry-After": str(settings.RATE_LIMIT_WINDOW_SECONDS)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(
            max(0, settings.RATE_LIMIT_REQUESTS - count)
        )
        return response


class RequestLimitMiddleware(BaseHTTPMiddleware):
    """Rejects oversized request bodies and enforces a per-request timeout."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_app_settings()

        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > settings.MAX_REQUEST_BODY_BYTES:
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
