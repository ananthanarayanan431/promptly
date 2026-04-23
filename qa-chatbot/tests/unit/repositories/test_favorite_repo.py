import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.repositories.favorite_repo import FavoriteRepository


async def _make_user(db: AsyncSession, email: str = "alice@test.com") -> User:
    u = User(email=email)
    db.add(u)
    await db.flush()
    return u


async def _make_version(
    db: AsyncSession, user: User, *, name: str = "fam", version: int = 1
) -> PromptVersion:
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name=name,
        version=version,
        content="hello world",
    )
    db.add(pv)
    await db.flush()
    return pv


@pytest.mark.asyncio
async def test_create_favorite(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    fav = await repo.create(
        user_id=user.id,
        prompt_version_id=version.id,
    )

    assert isinstance(fav, FavoritePrompt)
    assert fav.user_id == user.id
    assert fav.prompt_version_id == version.id
    assert fav.tags == []
    assert fav.category == "Other"


@pytest.mark.asyncio
async def test_get_by_version_returns_none_when_missing(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="a1@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    fav = await repo.get_by_version(user_id=user.id, prompt_version_id=version.id)
    assert fav is None


@pytest.mark.asyncio
async def test_get_by_version_returns_existing(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="a2@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)
    created = await repo.create(user_id=user.id, prompt_version_id=version.id)

    fetched = await repo.get_by_version(user_id=user.id, prompt_version_id=version.id)
    assert fetched is not None
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_get_by_version_is_user_scoped(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, email="o@test.com")
    other = await _make_user(db_session, email="x@test.com")
    version = await _make_version(db_session, owner)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=owner.id, prompt_version_id=version.id)

    # Other user must not see owner's favorite
    assert await repo.get_by_version(user_id=other.id, prompt_version_id=version.id) is None


@pytest.mark.asyncio
async def test_unique_constraint_prevents_duplicate(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="u1@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    await repo.create(user_id=user.id, prompt_version_id=version.id)
    with pytest.raises(IntegrityError):
        await repo.create(user_id=user.id, prompt_version_id=version.id)


@pytest.mark.asyncio
async def test_list_for_user_returns_only_own(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session, email="la@test.com")
    user_b = await _make_user(db_session, email="lb@test.com")
    v_a = await _make_version(db_session, user_a)
    v_b = await _make_version(db_session, user_b)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=user_a.id, prompt_version_id=v_a.id)
    await repo.create(user_id=user_b.id, prompt_version_id=v_b.id)

    rows, total = await repo.list_for_user(user_id=user_a.id)
    assert total == 1
    assert len(rows) == 1
    assert rows[0].user_id == user_a.id


@pytest.mark.asyncio
async def test_list_filters_by_category_and_tag(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="lf@test.com")
    v1 = await _make_version(db_session, user, name="a", version=1)
    v2 = await _make_version(db_session, user, name="b", version=1)
    repo = FavoriteRepository(db_session)
    await repo.create(
        user_id=user.id,
        prompt_version_id=v1.id,
        category="Writing",
        tags=["email", "cold"],
    )
    await repo.create(
        user_id=user.id,
        prompt_version_id=v2.id,
        category="Coding",
        tags=["python"],
    )

    rows, _ = await repo.list_for_user(user_id=user.id, category="Writing")
    assert len(rows) == 1 and rows[0].category == "Writing"

    rows, _ = await repo.list_for_user(user_id=user.id, tags=["python"])
    assert len(rows) == 1 and "python" in rows[0].tags


@pytest.mark.asyncio
async def test_list_pins_first(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="lp@test.com")
    v1 = await _make_version(db_session, user, name="a", version=1)
    v2 = await _make_version(db_session, user, name="b", version=1)
    repo = FavoriteRepository(db_session)
    f1 = await repo.create(user_id=user.id, prompt_version_id=v1.id)
    await asyncio.sleep(0.01)
    f2 = await repo.create(user_id=user.id, prompt_version_id=v2.id, is_pinned=True)

    rows, _ = await repo.list_for_user(user_id=user.id)
    assert rows[0].id == f2.id
    assert rows[1].id == f1.id


@pytest.mark.asyncio
async def test_distinct_tags_is_user_scoped(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, email="to@test.com")
    other = await _make_user(db_session, email="tx@test.com")
    v_own = await _make_version(db_session, owner, name="o", version=1)
    v_oth = await _make_version(db_session, other, name="x", version=1)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=owner.id, prompt_version_id=v_own.id, tags=["email", "b2b"])
    await repo.create(user_id=other.id, prompt_version_id=v_oth.id, tags=["python"])

    tags = await repo.distinct_tags(user_id=owner.id)
    assert tags == ["b2b", "email"]


@pytest.mark.asyncio
async def test_increment_use_updates_counter_and_last_used(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="iu@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)
    fav = await repo.create(user_id=user.id, prompt_version_id=version.id)
    before = datetime.now(UTC)

    await repo.increment_use(favorite_id=fav.id, user_id=user.id)

    await db_session.refresh(fav)
    assert fav.use_count == 1
    assert fav.last_used_at is not None and fav.last_used_at >= before
