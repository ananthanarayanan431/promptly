import asyncio
import time
import uuid
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.types.response import ResponseError
from app.config.app import get_app_settings
from app.config.rate_limit import get_rate_limit_settings


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Any:
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        try:
            response = await call_next(request)
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        except ResponseError as e:
            return JSONResponse(status_code=e.status_code, content={"detail": e.message})


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any) -> None:
        super().__init__(app)
        self.rate_limits: dict[str, list[float]] = {}

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_rate_limit_settings()

        # Simple in-memory rate limiting based on client IP
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()

        if client_ip not in self.rate_limits:
            self.rate_limits[client_ip] = []

        # Clean old requests
        self.rate_limits[client_ip] = [
            t for t in self.rate_limits[client_ip] if now - t < settings.RATE_LIMIT_WINDOW_SECONDS
        ]

        # Check limit
        if len(self.rate_limits[client_ip]) >= settings.RATE_LIMIT_REQUESTS:
            return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})

        # Add current request
        self.rate_limits[client_ip].append(now)

        return await call_next(request)


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
