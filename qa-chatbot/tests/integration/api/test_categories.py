"""Integration tests for the categories API endpoint."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_categories_includes_general(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/categories", headers=headers)
    assert res.status_code == 200
    categories = res.json()["data"]["categories"]
    slugs = [c["slug"] for c in categories]
    assert "general" in slugs


@pytest.mark.asyncio
async def test_list_categories_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/categories")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_custom_category(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.post(
        "/api/v1/categories",
        json={"name": "My Custom Category", "description": "For testing"},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]["category"]
    assert data["name"] == "My Custom Category"
    assert data["is_predefined"] is False


@pytest.mark.asyncio
async def test_create_category_unauthenticated(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/categories",
        json={"name": "Anon Category", "description": "Should fail"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_category_appears_in_list(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    await client.post(
        "/api/v1/categories",
        json={"name": "Unique Test Cat", "description": "For listing test"},
        headers=headers,
    )
    res = await client.get("/api/v1/categories", headers=headers)
    names = [c["name"] for c in res.json()["data"]["categories"]]
    assert "Unique Test Cat" in names


@pytest.mark.asyncio
async def test_delete_custom_category(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    await client.post(
        "/api/v1/categories",
        json={"name": "To Delete", "description": "Will be deleted"},
        headers=headers,
    )
    # Get its slug
    list_res = await client.get("/api/v1/categories", headers=headers)
    cats = list_res.json()["data"]["categories"]
    slug = next(c["slug"] for c in cats if c["name"] == "To Delete")

    res = await client.delete(f"/api/v1/categories/{slug}", headers=headers)
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_delete_nonexistent_category(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete("/api/v1/categories/does-not-exist", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_predefined_category_forbidden(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete("/api/v1/categories/general", headers=headers)
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_create_duplicate_category_slug_returns_409(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    await client.post(
        "/api/v1/categories",
        json={"name": "Conflict Test", "description": "First"},
        headers=headers,
    )
    # Creating the same name for the same user should conflict on slug
    res = await client.post(
        "/api/v1/categories",
        json={"name": "Conflict Test", "description": "Second"},
        headers=headers,
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_general_is_first_in_list(client: AsyncClient, make_user) -> None:
    """'general' category should always be at the top."""
    _, headers = await make_user()
    res = await client.get("/api/v1/categories", headers=headers)
    categories = res.json()["data"]["categories"]
    assert categories[0]["slug"] == "general"
