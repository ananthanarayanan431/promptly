import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.api_key_repo import ApiKeyRepository


async def _make_user(db: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:8]}@test.com")
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_create_api_key(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id,
        name="production",
        key_hash=uuid.uuid4().hex + uuid.uuid4().hex,
    )
    assert key.id is not None
    assert key.name == "production"
    assert key.is_active is True
    assert key.revoked_at is None


@pytest.mark.asyncio
async def test_list_by_user_returns_only_that_users_keys(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    await repo.create(user_id=user_a.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user_b.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await db_session.commit()

    keys = await repo.list_by_user(user_a.id)
    assert len(keys) == 1
    assert keys[0].name == "k1"


@pytest.mark.asyncio
async def test_get_active_by_hash_returns_active_key(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key_hash = uuid.uuid4().hex + uuid.uuid4().hex
    await repo.create(user_id=user.id, name="k", key_hash=key_hash)
    await db_session.commit()

    found = await repo.get_active_by_hash(key_hash)
    assert found is not None
    assert found.user_id == user.id


@pytest.mark.asyncio
async def test_get_active_by_hash_ignores_revoked(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key_hash = uuid.uuid4().hex + uuid.uuid4().hex
    key = await repo.create(user_id=user.id, name="k", key_hash=key_hash)
    await repo.revoke(key)
    await db_session.commit()

    found = await repo.get_active_by_hash(key_hash)
    assert found is None


@pytest.mark.asyncio
async def test_revoke_sets_is_active_false_and_revoked_at(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert key.is_active is False
    assert key.revoked_at is not None


@pytest.mark.asyncio
async def test_get_by_id_and_user_returns_none_for_wrong_user(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user_a.id, name="k", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await db_session.commit()

    result = await repo.get_by_id_and_user(key.id, user_b.id)
    assert result is None


@pytest.mark.asyncio
async def test_has_active_name_returns_true_for_active_duplicate(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    await repo.create(user_id=user.id, name="prod", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await db_session.commit()

    assert await repo.has_active_name(user.id, "prod") is True


@pytest.mark.asyncio
async def test_has_active_name_returns_false_after_revoke(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="prod", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.has_active_name(user.id, "prod") is False


@pytest.mark.asyncio
async def test_list_by_user_filters_active_only(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    keys = await repo.list_by_user(user.id, status="active")
    assert len(keys) == 1
    assert keys[0].name == "k2"


@pytest.mark.asyncio
async def test_list_by_user_filters_revoked_only(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    keys = await repo.list_by_user(user.id, status="revoked")
    assert len(keys) == 1
    assert keys[0].name == "k1"


@pytest.mark.asyncio
async def test_list_by_user_paginates(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    for i in range(5):
        await repo.create(
            user_id=user.id, name=f"k{i}", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
        )
    await db_session.commit()

    page1 = await repo.list_by_user(user.id, limit=2, offset=0)
    page2 = await repo.list_by_user(user.id, limit=2, offset=2)
    assert len(page1) == 2
    assert len(page2) == 2
    assert {k.name for k in page1}.isdisjoint({k.name for k in page2})


@pytest.mark.asyncio
async def test_count_by_user_all(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="all") == 2


@pytest.mark.asyncio
async def test_count_by_user_active(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="active") == 1


@pytest.mark.asyncio
async def test_count_by_user_revoked(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex
    )
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="revoked") == 1
