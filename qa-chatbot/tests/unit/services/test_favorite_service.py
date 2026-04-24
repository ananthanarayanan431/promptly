import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.services.favorite_service import FavoriteService


async def _seed(db: AsyncSession) -> tuple[User, PromptVersion]:
    user = User(email=f"u-{uuid.uuid4().hex[:6]}@test.com")
    db.add(user)
    await db.flush()
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name="fam",
        version=1,
        content="Write a concise cold outreach email to a B2B prospect",
    )
    db.add(pv)
    await db.flush()
    return user, pv


@pytest.mark.asyncio
async def test_like_creates_row_with_llm_tags(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)
    mock_gen = AsyncMock(return_value=({"email", "cold-outreach"}, "Writing"))

    with patch.object(service, "_generate_tags", mock_gen):
        fav, created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert created is True
    assert set(fav.tags) == {"email", "cold-outreach"}
    assert fav.category == "Writing"


@pytest.mark.asyncio
async def test_like_is_idempotent(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)
    mock_gen = AsyncMock(return_value=({"x"}, "Other"))

    with patch.object(service, "_generate_tags", mock_gen):
        first, first_created = await service.like(user_id=user.id, prompt_version_id=pv.id)
        second, second_created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert first_created is True
    assert second_created is False
    assert first.id == second.id
    assert mock_gen.await_count == 1


@pytest.mark.asyncio
async def test_like_falls_back_on_llm_failure(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)

    async def _boom(_content: str) -> tuple[set[str], str]:
        raise RuntimeError("network down")

    with patch.object(service, "_generate_tags", _boom):
        fav, created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert created is True
    assert fav.tags == []
    assert fav.category == "Other"


@pytest.mark.asyncio
async def test_like_rejects_other_users_version(db_session: AsyncSession) -> None:
    owner, pv = await _seed(db_session)
    stranger = User(email="stranger@test.com")
    db_session.add(stranger)
    await db_session.flush()
    service = FavoriteService(db_session)

    with pytest.raises(LookupError):
        await service.like(user_id=stranger.id, prompt_version_id=pv.id)


def test_extract_json_object_plain() -> None:
    from app.services.favorite_service import _extract_json_object

    assert _extract_json_object('{"tags": ["a"], "category": "Writing"}') == {
        "tags": ["a"],
        "category": "Writing",
    }


def test_extract_json_object_fenced() -> None:
    from app.services.favorite_service import _extract_json_object

    raw = '```json\n{"tags": [], "category": "Other"}\n```'
    assert _extract_json_object(raw) == {"tags": [], "category": "Other"}


def test_extract_json_object_garbage_returns_empty() -> None:
    from app.services.favorite_service import _extract_json_object

    assert _extract_json_object("totally not json") == {}
