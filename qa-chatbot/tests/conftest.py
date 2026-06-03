import uuid
from collections.abc import AsyncGenerator

import pytest_asyncio
from fastapi import Depends, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.exceptions import UnauthorizedException
from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.dependencies import get_current_user, get_db
from app.main import create_app
from app.models.base import Base
from app.repositories.user_repo import UserRepository

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


async def _test_auth_override(
    request: Request,
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> UserContext:
    """Test-only replacement for get_current_user.

    Authenticates via the ``X-Test-User-Id`` header (set by test helpers) and
    loads that user from the DB so credits/email reflect live row state. Absence
    of the header behaves like an unauthenticated request → 401, preserving the
    existing "unauthenticated returns 401" tests.
    """
    user_id_raw = request.headers.get("X-Test-User-Id")
    if not user_id_raw:
        raise UnauthorizedException(detail="Missing test auth header")
    try:
        user_id = uuid.UUID(user_id_raw)
    except (ValueError, TypeError):
        raise UnauthorizedException(detail="Missing or invalid test auth header") from None
    user = await UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active:
        raise UnauthorizedException(detail="Test user not found")
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=user.credits,
    )


@pytest_asyncio.fixture(loop_scope="session")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    # Override BOTH dependency paths that route handlers may use
    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_async_session] = _override
    app.dependency_overrides[get_current_user] = _test_auth_override

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
