from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.db.redis import get_redis_client
from app.dependencies import get_current_user
from app.models.user import User


class RateLimiter:
    """Per-user per-route sliding-window rate limiter used as a FastAPI dependency."""

    def __init__(self, requests: int, window_seconds: int) -> None:
        self.requests = requests
        self.window_seconds = window_seconds

    async def __call__(
        self,
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> None:
        redis = await get_redis_client()
        key = f"rl:user:{current_user.id}:{request.url.path}"
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, self.window_seconds, nx=True)
        results: list[int] = await pipe.execute()
        count: int = results[0]

        if count > self.requests:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={"Retry-After": str(self.window_seconds)},
            )
