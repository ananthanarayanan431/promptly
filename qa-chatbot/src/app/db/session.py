from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config.app import get_app_settings
from app.config.database import get_database_settings

db_settings = get_database_settings()
app_settings = get_app_settings()

engine = create_async_engine(
    str(db_settings.DATABASE_URL),
    pool_size=db_settings.DATABASE_POOL_SIZE,
    max_overflow=db_settings.DATABASE_MAX_OVERFLOW,
    pool_pre_ping=True,
    echo=app_settings.DEBUG,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def dispose_async_engine() -> None:
    """Drop pooled connections so the next asyncio.run() uses a fresh asyncpg pool.

    Celery calls ``asyncio.run()`` per task; each run uses a new event loop. Asyncpg
    connections must not be reused across loops — same rationale as
    ``reset_connection_pool()`` for Redis in ``tasks.py``.
    """
    await engine.dispose()


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
