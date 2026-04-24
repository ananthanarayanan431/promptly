"""Conftest for service unit tests.

Service tests require a real database. This conftest overrides the
``setup_db`` no-op from the parent unit conftest and provides a
``db_session`` fixture backed by the test PostgreSQL instance.
"""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.base import Base

TEST_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5433/qa_chatbot_test"


@pytest.fixture(scope="session", autouse=True)
def setup_db() -> None:  # type: ignore[override]
    """Override parent no-op: tables are created on first db_session use."""


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(TEST_DB_URL, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        yield session

    await engine.dispose()
