import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_version import PromptVersion
from app.models.user import User


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


@pytest.mark.asyncio
async def test_post_favorites_creates(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=({"email"}, "Writing")),
    ):
        res = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )

    assert res.status_code == 201
    body = res.json()["data"]
    assert body["prompt_version_id"] == str(pv.id)
    assert body["category"] == "Writing"
    assert body["tags"] == ["email"]
    assert body["id"]


@pytest.mark.asyncio
async def test_post_favorites_idempotent(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        first = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
        second = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
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
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    owner, _ = await make_user()
    _, other_headers = await make_user()
    pv = await _make_version(db_session, owner)

    res = await client.post(
        "/api/v1/favorites",
        json={"prompt_version_id": str(pv.id)},
        headers=other_headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_favorite_by_id(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fav_id = created.json()["data"]["id"]

    res = await client.delete(f"/api/v1/favorites/{fav_id}", headers=headers)
    assert res.status_code == 204

    res2 = await client.delete(f"/api/v1/favorites/{fav_id}", headers=headers)
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_delete_by_version(client: AsyncClient, db_session: AsyncSession, make_user) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )

    res = await client.delete(f"/api/v1/favorites/by-version/{pv.id}", headers=headers)
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_status_endpoint(client: AsyncClient, db_session: AsyncSession, make_user) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=headers,
    )
    assert res.json()["data"] == {"is_favorited": False, "prompt_store_id": None}

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    sid = created.json()["data"]["id"]

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=headers,
    )
    assert res.json()["data"]["is_favorited"] is True
    assert res.json()["data"]["prompt_store_id"] == sid


@pytest.mark.asyncio
async def test_list_filter_sort_paginate(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv1 = await _make_version(db_session, user, "apples and oranges")
    pv2 = await _make_version(db_session, user, "python quicksort")

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"fruit"}, "Writing"), ({"python"}, "Coding")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv1.id)},
            headers=headers,
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv2.id)},
            headers=headers,
        )

    res = await client.get("/api/v1/favorites", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2

    res = await client.get("/api/v1/favorites?category=Coding", headers=headers)
    assert res.json()["data"]["total"] == 1
    assert res.json()["data"]["items"][0]["category"] == "Coding"

    res = await client.get("/api/v1/favorites?tag=python", headers=headers)
    assert res.json()["data"]["total"] == 1

    res = await client.get("/api/v1/favorites?q=apple", headers=headers)
    assert res.json()["data"]["total"] == 1


@pytest.mark.asyncio
async def test_patch_updates_allowed_fields(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
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
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["note"] == "great for cold outreach"
    assert data["tags"] == ["email", "sales"]
    assert data["category"] == "Writing"
    assert data["is_pinned"] is True


@pytest.mark.asyncio
async def test_patch_validates_category(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fid = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fid}",
        json={"category": "NotARealCategory"},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_use_endpoint_increments(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fid = created.json()["data"]["id"]

    for _ in range(3):
        await client.post(f"/api/v1/favorites/{fid}/use", headers=headers)

    res = await client.get(f"/api/v1/favorites/{fid}", headers=headers)
    assert res.json()["data"]["use_count"] == 3
    assert res.json()["data"]["last_used_at"] is not None


@pytest.mark.asyncio
async def test_tags_endpoint_is_user_scoped(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user_a, headers_a = await make_user()
    user_b, headers_b = await make_user()
    pv_a = await _make_version(db_session, user_a)
    pv_b = await _make_version(db_session, user_b)
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"alpha", "beta"}, "Other"), ({"gamma"}, "Other")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_a.id)},
            headers=headers_a,
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_b.id)},
            headers=headers_b,
        )

    res = await client.get("/api/v1/favorites/tags", headers=headers_a)
    assert res.json()["data"]["tags"] == ["alpha", "beta"]


# ---------------------------------------------------------------------------
# Additional tests for uncovered lines
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_favorites_empty(client: AsyncClient, make_user) -> None:
    """List returns empty items/total when user has no favorites."""
    _, headers = await make_user()

    res = await client.get("/api/v1/favorites", headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 0
    assert data["items"] == []


@pytest.mark.asyncio
async def test_list_favorites_unauthenticated_returns_401(client: AsyncClient) -> None:
    res = await client.get("/api/v1/favorites")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_favorite_by_id_not_found_returns_404(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.get(f"/api/v1/favorites/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_favorite_by_id_returns_favorite(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fav_id = created.json()["data"]["id"]

    res = await client.get(f"/api/v1/favorites/{fav_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["id"] == fav_id


@pytest.mark.asyncio
async def test_unlike_nonexistent_favorite_returns_404(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.delete(f"/api/v1/favorites/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_unlike_by_version_not_favorited_returns_404(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    res = await client.delete(f"/api/v1/favorites/by-version/{pv.id}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_unlike_by_version_then_status_is_false(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )

    del_res = await client.delete(f"/api/v1/favorites/by-version/{pv.id}", headers=headers)
    assert del_res.status_code == 204

    status_res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=headers,
    )
    assert status_res.json()["data"]["is_favorited"] is False


@pytest.mark.asyncio
async def test_update_favorite_note_and_is_pinned(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fav_id = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fav_id}",
        json={"note": "my custom note", "is_pinned": True},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["note"] == "my custom note"
    assert data["is_pinned"] is True


@pytest.mark.asyncio
async def test_use_favorite_increments_use_count(
    client: AsyncClient, db_session: AsyncSession, make_user
) -> None:
    user, headers = await make_user()
    pv = await _make_version(db_session, user)

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=headers,
        )
    fav_id = created.json()["data"]["id"]

    use_res = await client.post(f"/api/v1/favorites/{fav_id}/use", headers=headers)
    assert use_res.status_code == 204

    get_res = await client.get(f"/api/v1/favorites/{fav_id}", headers=headers)
    assert get_res.json()["data"]["use_count"] == 1


@pytest.mark.asyncio
async def test_use_favorite_nonexistent_returns_404(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.post(f"/api/v1/favorites/{uuid.uuid4()}/use", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_status_check_false_for_unknown_version(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={uuid.uuid4()}",
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["data"]["is_favorited"] is False
    assert res.json()["data"]["prompt_store_id"] is None


@pytest.mark.asyncio
async def test_list_tags_empty_when_no_favorites(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()

    res = await client.get("/api/v1/favorites/tags", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["tags"] == []
