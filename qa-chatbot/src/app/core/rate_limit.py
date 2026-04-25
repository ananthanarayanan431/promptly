from typing import Annotated, Any

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request

from app.config.redis import get_redis_settings
from app.dependencies import get_current_user
from app.models.user import User


class RateLimiter:
    """Per-user per-route sliding-window rate limiter used as a FastAPI dependency."""

    def __init__(self, requests: int, window_seconds: int) -> None:
        self.requests = requests
        self.window_seconds = window_seconds
        redis_settings = get_redis_settings()
        self._redis: aioredis.Redis = aioredis.from_url(
            str(redis_settings.REDIS_URL),
            encoding="utf-8",
            decode_responses=True,
        )

    async def __call__(
        self,
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> None:
        key = f"rl:user:{current_user.id}:{request.url.path}"
        pipe = self._redis.pipeline()
        await pipe.incr(key)
        await pipe.expire(key, self.window_seconds, nx=True)
        results: list[Any] = await pipe.execute()
        count: int = results[0]

        if count > self.requests:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={"Retry-After": str(self.window_seconds)},
            )

        request.state.ratelimit_limit = self.requests
        request.state.ratelimit_remaining = max(0, self.requests - count)
