"""Integration tests for the domain-prompt API endpoints."""

from __future__ import annotations

import io
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()

_MINIMAL_PDF = b"%PDF-1.4 fake pdf content for testing purposes"
_VALID_PROMPT = "You are a helpful assistant. Answer questions based on the provided context."


async def _make_user_headers(client: AsyncClient) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _minio_patch() -> Any:
    """Return a context-manager mock that silences MinIO calls."""
    return patch.multiple(
        "app.domain_prompt.api.router",
        upload_bytes=MagicMock(),
        upload_text=MagicMock(),
        download_text=MagicMock(return_value=""),
        delete_objects_with_prefix=MagicMock(),
    )


@pytest.mark.asyncio
async def test_list_domains_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/domain-prompts/", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["domains"] == []


@pytest.mark.asyncio
async def test_list_domains_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/domain-prompts/")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_domain_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_domain_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.delete(f"/api/v1/domain-prompts/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_create_domain_unauthenticated(client: AsyncClient) -> None:
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_domain_non_pdf_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.txt", io.BytesIO(b"plain text content"), "text/plain")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_invalid_pdf_content_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A .pdf filename but non-PDF bytes should be rejected."""
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(b"not a real pdf"), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_domain_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from sqlalchemy import select

    from app.models.user import User

    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Test Domain"}
    res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_create_domain_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "My Test Domain", "description": "A test knowledge base"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        res = await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)

    assert res.status_code == 202
    data_out = res.json()["data"]
    assert "job_id" in data_out
    assert "domain_id" in data_out


@pytest.mark.asyncio
async def test_create_domain_appears_in_list(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Listed Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        await client.post("/api/v1/domain-prompts/", files=files, data=data, headers=headers)

    res = await client.get("/api/v1/domain-prompts/", headers=headers)
    assert res.status_code == 200
    assert len(res.json()["data"]["domains"]) == 1
    assert res.json()["data"]["domains"][0]["name"] == "Listed Domain"


@pytest.mark.asyncio
async def test_get_domain_after_create(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Get Domain Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["name"] == "Get Domain Test"


@pytest.mark.asyncio
async def test_get_domain_other_user_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    h1 = await _make_user_headers(client)
    h2 = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Private Domain"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=h1
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=h2)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_domain_job_queued(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Poll Job Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    job_id = create_res.json()["data"]["job_id"]

    res = await client.get(f"/api/v1/domain-prompts/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "queued"


@pytest.mark.asyncio
async def test_delete_domain_success(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Delete Me"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    with patch("anyio.to_thread.run_sync", side_effect=lambda fn: None):
        res = await client.delete(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res.status_code == 200

    # Confirm gone
    res2 = await client.get(f"/api/v1/domain-prompts/{domain_id}", headers=headers)
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/domain-prompts/{uuid.uuid4()!s}/runs", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_domain_runs_empty_after_create(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    files = {"file": ("test.pdf", io.BytesIO(_MINIMAL_PDF), "application/pdf")}
    data = {"name": "Runs Test"}

    with (
        _minio_patch(),
        patch("app.domain_prompt.api.router.prepare_domain_dataset.apply_async"),
        patch("anyio.to_thread.run_sync", side_effect=lambda fn: None),
    ):
        create_res = await client.post(
            "/api/v1/domain-prompts/", files=files, data=data, headers=headers
        )
    domain_id = create_res.json()["data"]["domain_id"]

    res = await client.get(f"/api/v1/domain-prompts/{domain_id}/runs", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["runs"] == []
