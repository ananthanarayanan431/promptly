"""Integration tests for the prompt-bridge API endpoints."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()


async def _make_user_headers(client: AsyncClient) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


_TRANSFER_BODY: dict[str, Any] = {
    "source_prompt": "You are a helpful assistant. Answer questions clearly and concisely.",
    "source_model": "openai/gpt-4o",
    "target_model": "anthropic/claude-3-5-haiku",
}


@pytest.mark.asyncio
async def test_list_jobs_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/prompt-bridge/jobs", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["jobs"] == []


@pytest.mark.asyncio
async def test_list_jobs_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/prompt-bridge/jobs")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_list_mappings_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get("/api/v1/prompt-bridge/mappings", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["mappings"] == []


@pytest.mark.asyncio
async def test_list_mappings_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/prompt-bridge/mappings")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_submit_transfer_same_model_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    body = {**_TRANSFER_BODY, "target_model": "openai/gpt-4o"}
    res = await client.post("/api/v1/prompt-bridge/transfer", json=body, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_submit_transfer_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_submit_transfer_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """User with 0 credits gets 402 on transfer."""
    from sqlalchemy import select

    from app.models.user import User

    email = fake.unique.email()
    password = "Pass123!"  # noqa: S105
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    # Drain all credits
    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = 0
    await db_session.commit()

    res = await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers)
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_submit_transfer_short_prompt_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    body = {**_TRANSFER_BODY, "source_prompt": "short"}
    res = await client.post("/api/v1/prompt-bridge/transfer", json=body, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_submit_transfer_creates_job(client: AsyncClient, db_session: AsyncSession) -> None:
    """Successful transfer returns 202 with job_id and credits_charged=5."""
    headers = await _make_user_headers(client)
    mock_celery = MagicMock()
    mock_celery.id = str(uuid.uuid4())
    with patch(
        "app.prompt_bridge.api.router.run_prompt_transfer.apply_async",
        return_value=mock_celery,
    ):
        res = await client.post(
            "/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers
        )
    assert res.status_code == 202
    data = res.json()["data"]
    assert "job_id" in data
    assert data["credits_charged"] == 5
    assert data["reused_mapping"] is False


@pytest.mark.asyncio
async def test_submit_transfer_job_appears_in_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_headers(client)
    mock_celery = MagicMock()
    mock_celery.id = str(uuid.uuid4())
    with patch(
        "app.prompt_bridge.api.router.run_prompt_transfer.apply_async",
        return_value=mock_celery,
    ):
        await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers)

    res = await client.get("/api/v1/prompt-bridge/jobs", headers=headers)
    assert res.status_code == 200
    assert len(res.json()["data"]["jobs"]) == 1


@pytest.mark.asyncio
async def test_poll_job_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_other_user_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    """Cannot poll a job that belongs to another user."""
    h1 = await _make_user_headers(client)
    h2 = await _make_user_headers(client)

    mock_celery = MagicMock()
    mock_celery.id = str(uuid.uuid4())
    with patch(
        "app.prompt_bridge.api.router.run_prompt_transfer.apply_async",
        return_value=mock_celery,
    ):
        create_res = await client.post(
            "/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=h1
        )
    job_id = create_res.json()["data"]["job_id"]

    res = await client.get(f"/api/v1/prompt-bridge/jobs/{job_id}", headers=h2)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_queued_status(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    mock_celery = MagicMock()
    mock_celery.id = str(uuid.uuid4())
    with patch(
        "app.prompt_bridge.api.router.run_prompt_transfer.apply_async",
        return_value=mock_celery,
    ):
        create_res = await client.post(
            "/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers
        )
    job_id = create_res.json()["data"]["job_id"]

    res = await client.get(f"/api/v1/prompt-bridge/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "queued"
    assert res.json()["data"]["job_id"] == job_id


@pytest.mark.asyncio
async def test_delete_job_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.delete(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_queued_job_blocked(client: AsyncClient, db_session: AsyncSession) -> None:
    """Deleting a queued job returns 409 — must cancel first."""
    headers = await _make_user_headers(client)
    mock_celery = MagicMock()
    mock_celery.id = str(uuid.uuid4())
    with patch(
        "app.prompt_bridge.api.router.run_prompt_transfer.apply_async",
        return_value=mock_celery,
    ):
        await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers)
    db_jobs_res = await client.get("/api/v1/prompt-bridge/jobs", headers=headers)
    db_job_id = db_jobs_res.json()["data"]["jobs"][0]["id"]

    res = await client.delete(f"/api/v1/prompt-bridge/jobs/{db_job_id}", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_get_mapping_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.get(f"/api/v1/prompt-bridge/mappings/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_mapping_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.delete(f"/api/v1/prompt-bridge/mappings/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_cancel_job_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}/cancel", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_cancel_by_db_id_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_headers(client)
    res = await client.post(
        f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}/cancel-by-id", headers=headers
    )
    assert res.status_code == 404
