import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.user_repo import UserRepository


async def _make_user(
    db: AsyncSession,
    *,
    clerk_user_id: str | None = None,
    email: str | None = None,
) -> User:
    user = User(
        email=email or f"{uuid.uuid4().hex[:8]}@test.com",
        clerk_user_id=clerk_user_id or uuid.uuid4().hex,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_get_by_clerk_id_returns_user(db_session: AsyncSession) -> None:
    clerk_id = f"user_{uuid.uuid4().hex}"
    await _make_user(db_session, clerk_user_id=clerk_id)
    await db_session.commit()

    repo = UserRepository(db_session)
    found = await repo.get_by_clerk_id(clerk_id)
    assert found is not None
    assert found.clerk_user_id == clerk_id


@pytest.mark.asyncio
async def test_get_by_clerk_id_returns_none_for_unknown(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    result = await repo.get_by_clerk_id("user_does_not_exist")
    assert result is None


@pytest.mark.asyncio
async def test_get_by_clerk_id_does_not_return_other_user(db_session: AsyncSession) -> None:
    clerk_id_a = f"user_{uuid.uuid4().hex}"
    clerk_id_b = f"user_{uuid.uuid4().hex}"
    await _make_user(db_session, clerk_user_id=clerk_id_a)
    await _make_user(db_session, clerk_user_id=clerk_id_b)
    await db_session.commit()

    repo = UserRepository(db_session)
    found = await repo.get_by_clerk_id(clerk_id_a)
    assert found is not None
    assert found.clerk_user_id == clerk_id_a
    assert found.clerk_user_id != clerk_id_b


@pytest.mark.asyncio
async def test_get_by_email_returns_user(db_session: AsyncSession) -> None:
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    await _make_user(db_session, email=email)
    await db_session.commit()

    repo = UserRepository(db_session)
    found = await repo.get_by_email(email)
    assert found is not None
    assert found.email == email


@pytest.mark.asyncio
async def test_get_by_email_returns_none_for_unknown(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    result = await repo.get_by_email("nobody@nowhere.example.com")
    assert result is None


@pytest.mark.asyncio
async def test_create_user_with_clerk_user_id(db_session: AsyncSession) -> None:
    clerk_id = f"user_{uuid.uuid4().hex}"
    email = f"{uuid.uuid4().hex[:8]}@test.com"

    repo = UserRepository(db_session)
    user = await repo.create(clerk_user_id=clerk_id, email=email)
    await db_session.commit()

    assert user.id is not None
    assert user.clerk_user_id == clerk_id
    assert user.email == email
    assert user.credits == 100
    assert user.is_active is True
