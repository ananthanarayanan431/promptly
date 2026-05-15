from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.session import get_async_session
from app.dependencies import get_db
from app.main import create_app
from app.models.base import Base

TEST_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5433/qa_chatbot_test"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _db_engine():  # type: ignore[return]  # noqa: ANN201
    """Session-scoped engine: create schema once, tear down at the end."""
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(_db_engine) -> AsyncGenerator[AsyncSession, None]:  # type: ignore[return]  # noqa: ANN001
    """Per-test session using the test DB. Truncates all tables after each test."""
    session_factory = async_sessionmaker(_db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()

    # Wipe all rows between tests to avoid cross-test state
    async with _db_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


@pytest_asyncio.fixture(loop_scope="session")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    # Override BOTH dependency paths that route handlers may use
    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_async_session] = _override

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
