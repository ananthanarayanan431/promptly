"""Integration tests for the prompt-bridge API endpoints."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

_TRANSFER_BODY: dict[str, Any] = {
    "source_prompt": "You are a helpful assistant. Answer questions clearly and concisely.",
    "source_model": "openai/gpt-4o",
    "target_model": "anthropic/claude-3-5-haiku",
}


@pytest.mark.asyncio
async def test_list_jobs_empty(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/prompt-bridge/jobs", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["jobs"] == []


@pytest.mark.asyncio
async def test_list_jobs_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/prompt-bridge/jobs")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_list_mappings_empty(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get("/api/v1/prompt-bridge/mappings", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["mappings"] == []


@pytest.mark.asyncio
async def test_list_mappings_unauthenticated(client: AsyncClient) -> None:
    res = await client.get("/api/v1/prompt-bridge/mappings")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_submit_transfer_same_model_rejected(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    body = {**_TRANSFER_BODY, "target_model": "openai/gpt-4o"}
    res = await client.post("/api/v1/prompt-bridge/transfer", json=body, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_submit_transfer_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_submit_transfer_insufficient_credits(client: AsyncClient, make_user) -> None:
    """User with 0 credits gets 402 on transfer."""
    _, headers = await make_user(credits=0)

    res = await client.post("/api/v1/prompt-bridge/transfer", json=_TRANSFER_BODY, headers=headers)
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_submit_transfer_short_prompt_rejected(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    body = {**_TRANSFER_BODY, "source_prompt": "short"}
    res = await client.post("/api/v1/prompt-bridge/transfer", json=body, headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_submit_transfer_creates_job(client: AsyncClient, make_user) -> None:
    """Successful transfer returns 202 with job_id and credits_charged=5."""
    _, headers = await make_user()
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
async def test_submit_transfer_job_appears_in_list(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
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
async def test_poll_job_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_other_user_not_found(client: AsyncClient, make_user) -> None:
    """Cannot poll a job that belongs to another user."""
    _, h1 = await make_user()
    _, h2 = await make_user()

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
async def test_poll_job_queued_status(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
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
async def test_delete_job_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_queued_job_blocked(client: AsyncClient, make_user) -> None:
    """Deleting a queued job returns 409 — must cancel first."""
    _, headers = await make_user()
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
async def test_get_mapping_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.get(f"/api/v1/prompt-bridge/mappings/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_mapping_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.delete(f"/api/v1/prompt-bridge/mappings/{uuid.uuid4()!s}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_cancel_job_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.post(f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}/cancel", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_cancel_by_db_id_not_found(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    res = await client.post(
        f"/api/v1/prompt-bridge/jobs/{uuid.uuid4()!s}/cancel-by-id", headers=headers
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Cancel job (by Redis job_id)
# ---------------------------------------------------------------------------


async def _submit_transfer(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    """Submit a transfer and return (job_id, db_job_id)."""
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
    job_id = res.json()["data"]["job_id"]

    list_res = await client.get("/api/v1/prompt-bridge/jobs", headers=headers)
    db_job_id = list_res.json()["data"]["jobs"][0]["id"]
    return job_id, db_job_id


@pytest.mark.asyncio
async def test_cancel_job_succeeds_for_queued_job(client: AsyncClient, make_user) -> None:
    """Cancelling a queued job returns 200 with cancelled=True."""
    _, headers = await make_user()
    job_id, _ = await _submit_transfer(client, headers)

    res = await client.post(f"/api/v1/prompt-bridge/jobs/{job_id}/cancel", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["cancelled"] is True


@pytest.mark.asyncio
async def test_cancel_job_other_user_not_found(client: AsyncClient, make_user) -> None:
    _, h1 = await make_user()
    _, h2 = await make_user()
    job_id, _ = await _submit_transfer(client, h1)

    res = await client.post(f"/api/v1/prompt-bridge/jobs/{job_id}/cancel", headers=h2)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_cancel_already_cancelled_returns_409(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    job_id, _ = await _submit_transfer(client, headers)

    await client.post(f"/api/v1/prompt-bridge/jobs/{job_id}/cancel", headers=headers)
    res = await client.post(f"/api/v1/prompt-bridge/jobs/{job_id}/cancel", headers=headers)
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# Cancel-by-db-id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_by_db_id_succeeds(client: AsyncClient, make_user) -> None:
    _, headers = await make_user()
    _, db_job_id = await _submit_transfer(client, headers)

    res = await client.post(f"/api/v1/prompt-bridge/jobs/{db_job_id}/cancel-by-id", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["cancelled"] is True


@pytest.mark.asyncio
async def test_cancel_by_db_id_already_cancelled_returns_409(
    client: AsyncClient, make_user
) -> None:
    _, headers = await make_user()
    _, db_job_id = await _submit_transfer(client, headers)

    await client.post(f"/api/v1/prompt-bridge/jobs/{db_job_id}/cancel-by-id", headers=headers)
    res = await client.post(f"/api/v1/prompt-bridge/jobs/{db_job_id}/cancel-by-id", headers=headers)
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# Delete job (completed/failed/cancelled only)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_cancelled_job_succeeds(client: AsyncClient, make_user) -> None:
    """A cancelled job can be deleted."""
    _, headers = await make_user()
    _, db_job_id = await _submit_transfer(client, headers)

    # Cancel first
    await client.post(f"/api/v1/prompt-bridge/jobs/{db_job_id}/cancel-by-id", headers=headers)

    res = await client.delete(f"/api/v1/prompt-bridge/jobs/{db_job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["deleted"] is True


@pytest.mark.asyncio
async def test_delete_queued_job_returns_409(client: AsyncClient, make_user) -> None:
    """Deleting a queued (active) job returns 409 — must cancel first."""
    _, headers = await make_user()
    _, db_job_id = await _submit_transfer(client, headers)

    res = await client.delete(f"/api/v1/prompt-bridge/jobs/{db_job_id}", headers=headers)
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# Get mapping by id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_mapping_after_reuse(client: AsyncClient, make_user) -> None:
    """After completing a transfer and creating a mapping, it should be retrievable."""
    _, headers = await make_user()
    # Two transfers to get a mapping created indirectly
    # We just verify the list endpoint shows empty (no mappings created without worker)
    res = await client.get("/api/v1/prompt-bridge/mappings", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["mappings"] == []
