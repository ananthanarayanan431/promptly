from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config.app import get_app_settings
from app.config.database import get_database_settings

db_settings = get_database_settings()
app_settings = get_app_settings()

# Supabase requires SSL; asyncpg takes it via connect_args.
_connect_args: dict = {"ssl": "require"} if db_settings.is_supabase else {}

engine = create_async_engine(
    db_settings.effective_url,
    pool_size=db_settings.effective_pool_size,
    max_overflow=db_settings.effective_max_overflow,
    pool_pre_ping=True,
    echo=app_settings.DEBUG,
    connect_args=_connect_args,
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
