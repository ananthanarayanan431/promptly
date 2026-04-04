import time
import uuid
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config.rate_limit import get_rate_limit_settings


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.rate_limits = {}

    async def dispatch(self, request: Request, call_next):
        settings = get_rate_limit_settings()
        
        # Simple in-memory rate limiting based on client IP
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        
        if client_ip not in self.rate_limits:
            self.rate_limits[client_ip] = []
            
        # Clean old requests
        self.rate_limits[client_ip] = [
            t for t in self.rate_limits[client_ip] 
            if now - t < settings.RATE_LIMIT_WINDOW_SECONDS
        ]
        
        # Check limit
        if len(self.rate_limits[client_ip]) >= settings.RATE_LIMIT_REQUESTS:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"}
            )
            
        # Add current request
        self.rate_limits[client_ip].append(now)
        
        return await call_next(request)