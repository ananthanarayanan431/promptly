import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.prompt_version import PromptVersion
from app.models.user import User


async def _make_user_and_token(db: AsyncSession, email: str) -> tuple[User, str]:
    user = User(email=email)
    db.add(user)
    await db.flush()
    token = create_access_token(subject=str(user.id))
    return user, token


async def _make_version(
    db: AsyncSession, user: User, content: str = "demo prompt"
) -> PromptVersion:
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name="fam-" + uuid.uuid4().hex[:6],
        version=1,
        content=content,
    )
    db.add(pv)
    await db.flush()
    return pv


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_post_favorites_creates(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "a@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=({"email"}, "Writing")),
    ):
        res = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    assert res.status_code == 201
    body = res.json()["data"]
    assert body["prompt_version_id"] == str(pv.id)
    assert body["category"] == "Writing"
    assert body["tags"] == ["email"]
    assert body["id"]


@pytest.mark.asyncio
async def test_post_favorites_idempotent(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "i@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        first = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
        second = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["data"]["id"] == second.json()["data"]["id"]


@pytest.mark.asyncio
async def test_post_favorites_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/favorites", json={"prompt_version_id": str(uuid.uuid4())})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_post_favorites_rejects_other_users_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _make_user_and_token(db_session, "owner@test.com")
    _, other_token = await _make_user_and_token(db_session, "other@test.com")
    pv = await _make_version(db_session, owner)
    await db_session.commit()

    res = await client.post(
        "/api/v1/favorites",
        json={"prompt_version_id": str(pv.id)},
        headers=_auth(other_token),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_favorite_by_id(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "d@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fav_id = created.json()["data"]["id"]

    res = await client.delete(f"/api/v1/favorites/{fav_id}", headers=_auth(token))
    assert res.status_code == 204

    res2 = await client.delete(f"/api/v1/favorites/{fav_id}", headers=_auth(token))
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_delete_by_version(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "dv@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    res = await client.delete(f"/api/v1/favorites/by-version/{pv.id}", headers=_auth(token))
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_status_endpoint(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "s@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=_auth(token),
    )
    assert res.json()["data"] == {"is_favorited": False, "prompt_store_id": None}

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    sid = created.json()["data"]["id"]

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=_auth(token),
    )
    assert res.json()["data"]["is_favorited"] is True
    assert res.json()["data"]["prompt_store_id"] == sid


@pytest.mark.asyncio
async def test_list_filter_sort_paginate(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "l@test.com")
    pv1 = await _make_version(db_session, user, "apples and oranges")
    pv2 = await _make_version(db_session, user, "python quicksort")
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"fruit"}, "Writing"), ({"python"}, "Coding")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv1.id)},
            headers=_auth(token),
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv2.id)},
            headers=_auth(token),
        )

    res = await client.get("/api/v1/favorites", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2

    res = await client.get("/api/v1/favorites?category=Coding", headers=_auth(token))
    assert res.json()["data"]["total"] == 1
    assert res.json()["data"]["items"][0]["category"] == "Coding"

    res = await client.get("/api/v1/favorites?tag=python", headers=_auth(token))
    assert res.json()["data"]["total"] == 1

    res = await client.get("/api/v1/favorites?q=apple", headers=_auth(token))
    assert res.json()["data"]["total"] == 1


@pytest.mark.asyncio
async def test_patch_updates_allowed_fields(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "p@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fid}",
        json={
            "note": "great for cold outreach",
            "tags": ["email", "sales"],
            "category": "Writing",
            "is_pinned": True,
        },
        headers=_auth(token),
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["note"] == "great for cold outreach"
    assert data["tags"] == ["email", "sales"]
    assert data["category"] == "Writing"
    assert data["is_pinned"] is True


@pytest.mark.asyncio
async def test_patch_validates_category(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "pv@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fid}",
        json={"category": "NotARealCategory"},
        headers=_auth(token),
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_use_endpoint_increments(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "u@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    for _ in range(3):
        await client.post(f"/api/v1/favorites/{fid}/use", headers=_auth(token))

    res = await client.get(f"/api/v1/favorites/{fid}", headers=_auth(token))
    assert res.json()["data"]["use_count"] == 3
    assert res.json()["data"]["last_used_at"] is not None


@pytest.mark.asyncio
async def test_tags_endpoint_is_user_scoped(client: AsyncClient, db_session: AsyncSession) -> None:
    user_a, tok_a = await _make_user_and_token(db_session, "ta@test.com")
    user_b, tok_b = await _make_user_and_token(db_session, "tb@test.com")
    pv_a = await _make_version(db_session, user_a)
    pv_b = await _make_version(db_session, user_b)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"alpha", "beta"}, "Other"), ({"gamma"}, "Other")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_a.id)},
            headers=_auth(tok_a),
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_b.id)},
            headers=_auth(tok_b),
        )

    res = await client.get("/api/v1/favorites/tags", headers=_auth(tok_a))
    assert res.json()["data"]["tags"] == ["alpha", "beta"]
