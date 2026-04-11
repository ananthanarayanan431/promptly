from redis.asyncio import ConnectionPool, Redis

from app.config.redis import get_redis_settings

redis_settings = get_redis_settings()

_pool: ConnectionPool | None = None


def get_connection_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool.from_url(
            str(redis_settings.REDIS_URL),
            max_connections=50,
            decode_responses=True,
        )
    return _pool


def reset_connection_pool() -> None:
    """Reset the module-level pool so the next call creates a fresh one.

    Must be called at the start of each Celery task before any async Redis
    operations — asyncio.run() closes the event loop when it returns, making
    the existing pool's connections invalid for the next task's event loop.
    """
    global _pool
    _pool = None


async def get_redis_client() -> Redis:
    return Redis(connection_pool=get_connection_pool())
