from redis.asyncio import Redis
from redis.asyncio import ConnectionPool
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


async def get_redis_client() -> Redis:
    return Redis(connection_pool=get_connection_pool())